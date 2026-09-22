-- Fair Play Rewards foundation.
-- This migration creates only the auditable data and trusted database
-- primitives needed by the later loyalty scheduler and admin controls.

create table if not exists public.loyalty_config (
  id boolean primary key default true check (id),
  launch_at timestamptz not null default clock_timestamp(),
  completion_delay interval not null default interval '24 hours'
);

insert into public.loyalty_config (id, launch_at, completion_delay)
values (true, clock_timestamp(), interval '24 hours')
on conflict (id) do nothing;

create table if not exists public.loyalty_reward_cycles (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  wallet_transaction_id bigint unique references public.wallet_transactions(id) on delete set null,
  idempotency_key text not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.loyalty_booking_contributions (
  booking_id bigint primary key,
  user_id uuid not null,
  game_id bigint not null,
  payment_id bigint not null,
  qualified_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text,
  consumed_by_reward_cycle_id bigint references public.loyalty_reward_cycles(id),
  offset_by_adjustment_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint loyalty_booking_contributions_not_both_consumed_or_offset
    check (not (consumed_by_reward_cycle_id is not null and offset_by_adjustment_id is not null))
);

create table if not exists public.loyalty_progress_adjustments (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  games_delta smallint not null check (games_delta in (-1, 1)),
  source text not null check (source in ('admin', 'system_reversal')),
  reason text not null,
  created_by uuid,
  request_id uuid,
  idempotency_key text not null unique,
  consumed_by_reward_cycle_id bigint references public.loyalty_reward_cycles(id),
  reversed_by_adjustment_id bigint references public.loyalty_progress_adjustments(id),
  offset_adjustment_id bigint references public.loyalty_progress_adjustments(id),
  offset_contribution_id bigint references public.loyalty_booking_contributions(booking_id),
  reversal_of_contribution_id bigint references public.loyalty_booking_contributions(booking_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint loyalty_progress_adjustments_source_actor_check
    check (
      (source = 'admin' and created_by is not null)
      or (source = 'system_reversal' and created_by is null)
    ),
  constraint loyalty_progress_adjustments_positive_links_check
    check (
      games_delta = 1
      or (consumed_by_reward_cycle_id is null and reversed_by_adjustment_id is null and offset_adjustment_id is null)
    ),
  constraint loyalty_progress_adjustments_positive_state_check
    check (
      games_delta <> 1
      or num_nonnulls(consumed_by_reward_cycle_id, reversed_by_adjustment_id) <= 1
    ),
  constraint loyalty_progress_adjustments_negative_links_check
    check (
      games_delta = -1
      or (offset_adjustment_id is null and offset_contribution_id is null and reversal_of_contribution_id is null)
    ),
  constraint loyalty_progress_adjustments_negative_offset_check
    check (
      games_delta <> -1
      or num_nonnulls(offset_adjustment_id, offset_contribution_id) <= 1
    )
);

create table if not exists public.loyalty_booking_ineligibility (
  booking_id bigint primary key,
  user_id uuid,
  game_id bigint,
  returned_value_transaction_id bigint unique references public.wallet_transactions(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.loyalty_booking_contributions
  add constraint loyalty_booking_contributions_offset_adjustment_fk
  foreign key (offset_by_adjustment_id)
  references public.loyalty_progress_adjustments(id);

create unique index if not exists loyalty_contributions_offset_adjustment_uidx
  on public.loyalty_booking_contributions(offset_by_adjustment_id)
  where offset_by_adjustment_id is not null;

create unique index if not exists loyalty_adjustments_reversal_contribution_uidx
  on public.loyalty_progress_adjustments(reversal_of_contribution_id)
  where reversal_of_contribution_id is not null;

create index if not exists loyalty_contributions_user_progress_idx
  on public.loyalty_booking_contributions(user_id, revoked_at, consumed_by_reward_cycle_id, offset_by_adjustment_id);

create index if not exists loyalty_adjustments_user_progress_idx
  on public.loyalty_progress_adjustments(user_id, games_delta, consumed_by_reward_cycle_id, reversed_by_adjustment_id, offset_adjustment_id, offset_contribution_id);

create index if not exists loyalty_reward_cycles_user_created_idx
  on public.loyalty_reward_cycles(user_id, created_at);

alter table public.loyalty_config enable row level security;
alter table public.loyalty_booking_contributions enable row level security;
alter table public.loyalty_reward_cycles enable row level security;
alter table public.loyalty_progress_adjustments enable row level security;
alter table public.loyalty_booking_ineligibility enable row level security;

revoke all on public.loyalty_config from public, anon, authenticated, service_role;
revoke all on public.loyalty_booking_contributions from public, anon, authenticated, service_role;
revoke all on public.loyalty_reward_cycles from public, anon, authenticated, service_role;
revoke all on public.loyalty_progress_adjustments from public, anon, authenticated, service_role;
revoke all on public.loyalty_booking_ineligibility from public, anon, authenticated, service_role;

create or replace function public.apply_pending_loyalty_negative_adjustments(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adjustment record;
  v_positive_adjustment_id bigint;
  v_contribution_id bigint;
  v_applied integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('loyalty:' || p_user_id::text));

  for v_adjustment in
    select adjustment.id
    from public.loyalty_progress_adjustments as adjustment
    where adjustment.user_id = p_user_id
      and adjustment.games_delta = -1
      and adjustment.offset_contribution_id is null
      and adjustment.reversed_by_adjustment_id is null
      and adjustment.offset_adjustment_id is null
    order by adjustment.id
    for update skip locked
  loop
    v_positive_adjustment_id := null;
    select adjustment.id
    into v_positive_adjustment_id
    from public.loyalty_progress_adjustments as adjustment
    where adjustment.user_id = p_user_id
      and adjustment.games_delta = 1
      and adjustment.consumed_by_reward_cycle_id is null
      and adjustment.reversed_by_adjustment_id is null
      and adjustment.offset_adjustment_id is null
    order by adjustment.id desc
    limit 1
    for update;

    if v_positive_adjustment_id is not null then
      update public.loyalty_progress_adjustments
      set reversed_by_adjustment_id = v_adjustment.id,
          updated_at = clock_timestamp()
      where id = v_positive_adjustment_id
        and reversed_by_adjustment_id is null
        and consumed_by_reward_cycle_id is null
        and offset_adjustment_id is null;

      if found then
        update public.loyalty_progress_adjustments
        set offset_adjustment_id = v_positive_adjustment_id,
            updated_at = clock_timestamp()
        where id = v_adjustment.id
          and offset_adjustment_id is null;
        v_applied := v_applied + 1;
        continue;
      end if;
    end if;

    v_contribution_id := null;
    select contribution.booking_id
    into v_contribution_id
    from public.loyalty_booking_contributions as contribution
    where contribution.user_id = p_user_id
      and contribution.revoked_at is null
      and contribution.consumed_by_reward_cycle_id is null
      and contribution.offset_by_adjustment_id is null
    order by contribution.qualified_at desc, contribution.booking_id desc
    limit 1
    for update;

    if v_contribution_id is not null then
      update public.loyalty_booking_contributions
      set offset_by_adjustment_id = v_adjustment.id,
          updated_at = clock_timestamp()
      where booking_id = v_contribution_id
        and consumed_by_reward_cycle_id is null
        and offset_by_adjustment_id is null;

      if found then
        update public.loyalty_progress_adjustments
        set offset_contribution_id = v_contribution_id,
            updated_at = clock_timestamp()
        where id = v_adjustment.id
          and offset_contribution_id is null;
        v_applied := v_applied + 1;
      end if;
    end if;
  end loop;

  return v_applied;
end;
$$;

create or replace function public.revoke_loyalty_contribution(
  p_booking_id bigint,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution public.loyalty_booking_contributions%rowtype;
  v_reversal_key text;
begin
  if p_booking_id is null then
    return false;
  end if;

  select contribution.*
  into v_contribution
  from public.loyalty_booking_contributions as contribution
  where contribution.booking_id = p_booking_id
  for update;

  if v_contribution.booking_id is null then
    return false;
  end if;

  if v_contribution.revoked_at is null then
    update public.loyalty_booking_contributions
    set revoked_at = clock_timestamp(),
        revocation_reason = nullif(trim(p_reason), ''),
        updated_at = clock_timestamp()
    where booking_id = p_booking_id;
  end if;

  if v_contribution.consumed_by_reward_cycle_id is not null then
    v_reversal_key := 'loyalty:system-reversal:contribution:' || p_booking_id::text;

    insert into public.loyalty_progress_adjustments (
      user_id,
      games_delta,
      source,
      reason,
      created_by,
      request_id,
      idempotency_key,
      reversal_of_contribution_id
    )
    values (
      v_contribution.user_id,
      -1,
      'system_reversal',
      coalesce(nullif(trim(p_reason), ''), 'Returned booking value'),
      null,
      null,
      v_reversal_key,
      p_booking_id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return true;
end;
$$;

create or replace function public.loyalty_revoke_player_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'released' then
    perform public.revoke_loyalty_contribution(new.booking_id, 'Player cancellation or returned value');
  end if;
  return new;
end;
$$;

create or replace function public.loyalty_revoke_game_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution record;
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    for v_contribution in
      select contribution.booking_id
      from public.loyalty_booking_contributions as contribution
      where contribution.game_id = new.id
        and contribution.revoked_at is null
    loop
      perform public.revoke_loyalty_contribution(v_contribution.booking_id, 'Game cancelled');
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.loyalty_revoke_returned_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
    and new.booking_id is not null
    and new.transaction_type in ('game_cancelled_credit', 'player_cancelled_credit', 'refund_completed')
  then
    perform 1
    from public.bookings as booking
    where booking.id = new.booking_id
    for update;

    insert into public.loyalty_booking_ineligibility (
      booking_id,
      user_id,
      game_id,
      returned_value_transaction_id,
      reason
    )
    values (
      new.booking_id,
      new.user_id,
      new.game_id,
      new.id,
      'Returned booking value'
    )
    on conflict (booking_id) do nothing;

    perform public.revoke_loyalty_contribution(new.booking_id, 'Booking value returned');
  end if;
  return new;
end;
$$;

drop trigger if exists loyalty_player_cancellation_revoke on public.player_booking_cancellations;
create trigger loyalty_player_cancellation_revoke
after insert or update of status on public.player_booking_cancellations
for each row
when (new.status = 'released')
execute function public.loyalty_revoke_player_cancellation();

drop trigger if exists loyalty_game_cancellation_revoke on public.games;
create trigger loyalty_game_cancellation_revoke
after update of status on public.games
for each row
when (new.status = 'cancelled')
execute function public.loyalty_revoke_game_cancellation();

drop trigger if exists loyalty_returned_value_revoke on public.wallet_transactions;
create trigger loyalty_returned_value_revoke
after insert or update of transaction_type, status, booking_id on public.wallet_transactions
for each row
when (
  new.status = 'completed'
  and new.booking_id is not null
  and new.transaction_type in ('game_cancelled_credit', 'player_cancelled_credit', 'refund_completed')
)
execute function public.loyalty_revoke_returned_value();

create or replace function public.reconcile_loyalty_rewards(
  p_booking_limit integer default 500
)
returns table (
  bookings_checked integer,
  contributions_created integer,
  rewards_issued integer,
  negative_adjustments_applied integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config public.loyalty_config%rowtype;
  v_booking record;
  v_user_id uuid;
  v_contribution_count integer;
  v_adjustment_count integer;
  v_available_units integer;
  v_selected_units integer;
  v_cycle_ordinal integer;
  v_cycle_id bigint;
  v_contribution_id bigint;
  v_adjustment_id bigint;
  v_credit_success boolean;
  v_wallet_transaction_id bigint;
  v_cycle_key text;
  v_returned_value_found boolean;
  v_bookings_checked integer := 0;
  v_contributions_created integer := 0;
  v_rewards_issued integer := 0;
  v_negative_adjustments_applied integer := 0;
begin
  if p_booking_limit is null or p_booking_limit < 1 then
    raise exception 'Invalid loyalty booking limit';
  end if;

  select config.*
  into v_config
  from public.loyalty_config as config
  where config.id = true;

  if v_config.id is not true then
    raise exception 'Loyalty configuration is missing';
  end if;

  for v_booking in
    select
      booking.id as booking_id,
      booking.user_id,
      booking.game_id,
      payment.id as payment_id
    from public.bookings as booking
    join public.games as game on game.id = booking.game_id
    join public.booking_payments as payment on payment.booking_id = booking.id
    where booking.user_id is not null
      and booking.booking_source = 'fair_play'
      and booking.created_at >= v_config.launch_at
      and game.status = 'active'
      and game.starts_at <= clock_timestamp() - v_config.completion_delay
      and payment.payment_status = 'paid'
      and payment.amount > 0
      and not exists (
        select 1
        from public.loyalty_booking_contributions as existing_contribution
        where existing_contribution.booking_id = booking.id
      )
      and not exists (
        select 1
        from public.player_booking_cancellations as cancellation
        where cancellation.booking_id = booking.id
      )
      and not exists (
        select 1
        from public.wallet_transactions as returned_value
        where returned_value.booking_id = booking.id
          and returned_value.status = 'completed'
          and returned_value.transaction_type in ('game_cancelled_credit', 'player_cancelled_credit', 'refund_completed')
      )
      and not exists (
        select 1
        from public.loyalty_booking_ineligibility as ineligible
        where ineligible.booking_id = booking.id
      )
      and not exists (
        select 1
        from public.wallet_transactions as wallet_payment
        where wallet_payment.booking_id = booking.id
          and wallet_payment.transaction_type = 'wallet_booking_payment'
          and wallet_payment.status = 'completed'
          and wallet_payment.amount < 0
      )
    order by game.starts_at, booking.id
    limit p_booking_limit
    for update of booking
  loop
    v_bookings_checked := v_bookings_checked + 1;

    select exists (
      select 1
      from public.loyalty_booking_ineligibility as ineligible
      where ineligible.booking_id = v_booking.booking_id
    )
    or exists (
      select 1
      from public.wallet_transactions as returned_value
      where returned_value.booking_id = v_booking.booking_id
        and returned_value.status = 'completed'
        and returned_value.transaction_type in ('game_cancelled_credit', 'player_cancelled_credit', 'refund_completed')
    )
    into v_returned_value_found;

    if v_returned_value_found then
      continue;
    end if;

    insert into public.loyalty_booking_contributions (
      booking_id,
      user_id,
      game_id,
      payment_id
    )
    values (
      v_booking.booking_id,
      v_booking.user_id,
      v_booking.game_id,
      v_booking.payment_id
    )
    on conflict (booking_id) do nothing;

    if found then
      v_contributions_created := v_contributions_created + 1;
    end if;
  end loop;

  for v_user_id in
    select distinct contribution.user_id
    from public.loyalty_booking_contributions as contribution
    where contribution.revoked_at is null
    union
    select distinct adjustment.user_id
    from public.loyalty_progress_adjustments as adjustment
  loop
    v_negative_adjustments_applied := v_negative_adjustments_applied
      + public.apply_pending_loyalty_negative_adjustments(v_user_id);

    perform pg_advisory_xact_lock(hashtext('loyalty:' || v_user_id::text));

    loop
      select count(*)
      into v_contribution_count
      from public.loyalty_booking_contributions as contribution
      where contribution.user_id = v_user_id
        and contribution.revoked_at is null
        and contribution.consumed_by_reward_cycle_id is null
        and contribution.offset_by_adjustment_id is null;

      select count(*)
      into v_adjustment_count
      from public.loyalty_progress_adjustments as adjustment
      where adjustment.user_id = v_user_id
        and adjustment.games_delta = 1
        and adjustment.consumed_by_reward_cycle_id is null
        and adjustment.reversed_by_adjustment_id is null
        and adjustment.offset_adjustment_id is null;

      v_available_units := v_contribution_count + v_adjustment_count;
      exit when v_available_units < 5;

      select count(*) + 1
      into v_cycle_ordinal
      from public.loyalty_reward_cycles as cycle
      where cycle.user_id = v_user_id;

      v_cycle_key := 'loyalty:reward:user:' || v_user_id::text || ':cycle:' || v_cycle_ordinal::text;

      select credit.success, credit.transaction_id
      into v_credit_success, v_wallet_transaction_id
      from public.create_wallet_credit_once(
        p_user_id => v_user_id,
        p_amount => 5.00,
        p_currency => 'GBP',
        p_transaction_type => 'promotion_bonus',
        p_idempotency_key => v_cycle_key,
        p_description => 'Fair Play Rewards: five qualifying games',
        p_metadata => jsonb_build_object('loyalty_cycle_key', v_cycle_key)
      ) as credit;

      if not coalesce(v_credit_success, false) or v_wallet_transaction_id is null then
        raise exception 'Unable to issue loyalty wallet credit for %', v_user_id;
      end if;

      insert into public.loyalty_reward_cycles (
        user_id,
        wallet_transaction_id,
        idempotency_key
      )
      values (v_user_id, v_wallet_transaction_id, v_cycle_key)
      on conflict (idempotency_key) do nothing
      returning id into v_cycle_id;

      if v_cycle_id is null then
        select cycle.id
        into v_cycle_id
        from public.loyalty_reward_cycles as cycle
        where cycle.idempotency_key = v_cycle_key;
      end if;

      v_selected_units := 0;

      for v_contribution_id in
        select contribution.booking_id
        from public.loyalty_booking_contributions as contribution
        where contribution.user_id = v_user_id
          and contribution.revoked_at is null
          and contribution.consumed_by_reward_cycle_id is null
          and contribution.offset_by_adjustment_id is null
        order by contribution.qualified_at, contribution.booking_id
        limit 5
        for update
      loop
        update public.loyalty_booking_contributions
        set consumed_by_reward_cycle_id = v_cycle_id,
            updated_at = clock_timestamp()
        where booking_id = v_contribution_id
          and consumed_by_reward_cycle_id is null
          and offset_by_adjustment_id is null
          and revoked_at is null;

        if not found then
          raise exception 'Loyalty contribution changed during reward issuance';
        end if;
        v_selected_units := v_selected_units + 1;
        exit when v_selected_units = 5;
      end loop;

      if v_selected_units < 5 then
        for v_adjustment_id in
          select adjustment.id
          from public.loyalty_progress_adjustments as adjustment
          where adjustment.user_id = v_user_id
            and adjustment.games_delta = 1
            and adjustment.consumed_by_reward_cycle_id is null
            and adjustment.reversed_by_adjustment_id is null
            and adjustment.offset_adjustment_id is null
          order by adjustment.id
          limit (5 - v_selected_units)
          for update
        loop
          update public.loyalty_progress_adjustments
          set consumed_by_reward_cycle_id = v_cycle_id,
              updated_at = clock_timestamp()
          where id = v_adjustment_id
            and consumed_by_reward_cycle_id is null
            and reversed_by_adjustment_id is null
            and offset_adjustment_id is null;

          if not found then
            raise exception 'Loyalty adjustment changed during reward issuance';
          end if;
          v_selected_units := v_selected_units + 1;
        end loop;
      end if;

      if v_selected_units <> 5 then
        raise exception 'Loyalty reward cycle did not consume exactly five units';
      end if;

      v_rewards_issued := v_rewards_issued + 1;
    end loop;
  end loop;

  return query select
    v_bookings_checked,
    v_contributions_created,
    v_rewards_issued,
    v_negative_adjustments_applied;
end;
$$;

revoke all on function public.apply_pending_loyalty_negative_adjustments(uuid) from public, anon, authenticated;
revoke all on function public.revoke_loyalty_contribution(bigint, text) from public, anon, authenticated;
revoke all on function public.reconcile_loyalty_rewards(integer) from public, anon, authenticated;
revoke all on function public.apply_pending_loyalty_negative_adjustments(uuid) from service_role;
revoke all on function public.revoke_loyalty_contribution(bigint, text) from service_role;
grant execute on function public.reconcile_loyalty_rewards(integer) to service_role;

revoke all on function public.loyalty_revoke_player_cancellation() from public, anon, authenticated;
revoke all on function public.loyalty_revoke_game_cancellation() from public, anon, authenticated;
revoke all on function public.loyalty_revoke_returned_value() from public, anon, authenticated;
