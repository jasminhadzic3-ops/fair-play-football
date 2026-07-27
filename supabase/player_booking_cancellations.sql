-- Player self-cancellation refund policy foundation.
-- Run manually in Supabase before deploying app code that uses
-- public.cancel_player_booking_with_refund_policy.

alter table public.wallet_transactions
drop constraint if exists wallet_transactions_transaction_type_check;

alter table public.wallet_transactions
add constraint wallet_transactions_transaction_type_check
check (
  transaction_type in (
    'game_cancelled_credit',
    'player_cancelled_credit',
    'wallet_booking_payment',
    'refund_requested',
    'refund_completed',
    'manual_adjustment',
    'admin_credit',
    'promotion_bonus'
  )
);

create table if not exists public.player_booking_cancellations (
  id bigint generated always as identity primary key,
  booking_id bigint not null,
  game_id bigint not null,
  user_id uuid not null,
  booking_payment_id bigint,
  wallet_transaction_id bigint,
  source_credit_transaction_id bigint,
  refund_request_id bigint,
  payment_method text not null
    check (payment_method in ('sumup', 'wallet', 'legacy')),
  refund_policy text not null
    check (refund_policy in ('eligible_24h', 'ineligible_within_24h', 'support_required')),
  status text not null default 'recorded'
    check (status in ('recorded', 'released', 'blocked')),
  reason text,
  amount numeric(10, 2),
  currency text not null default 'GBP',
  was_full_before_release boolean not null default false,
  space_available_after_release boolean not null default false,
  cancelled_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.player_booking_cancellations is
'Durable audit records for player self-cancellations. booking_id is an immutable historical snapshot because the booking row is released/deleted after the refund decision is recorded.';

comment on column public.player_booking_cancellations.booking_id is
'Historical booking id snapshot. This intentionally has no restrictive booking foreign key so the booking row can be released while preserving the cancellation audit.';

comment on column public.player_booking_cancellations.metadata is
'Sanitized operational metadata only. Do not store names, emails, provider payloads, transaction codes, SumUp IDs, tokens, or personal data.';

create unique index if not exists player_booking_cancellations_one_per_booking_uidx
on public.player_booking_cancellations(booking_id);

create index if not exists player_booking_cancellations_user_created_idx
on public.player_booking_cancellations(user_id, created_at desc);

create index if not exists player_booking_cancellations_game_created_idx
on public.player_booking_cancellations(game_id, created_at desc);

create unique index if not exists wallet_player_cancelled_credit_one_sumup_source_uidx
on public.wallet_transactions((metadata->>'original_booking_id'), (metadata->>'original_payment_id'))
where transaction_type = 'player_cancelled_credit'
  and status = 'completed'
  and metadata->>'original_payment_method' = 'sumup'
  and metadata ? 'original_booking_id'
  and metadata ? 'original_payment_id';

create unique index if not exists wallet_player_cancelled_credit_one_wallet_source_uidx
on public.wallet_transactions((metadata->>'original_wallet_transaction_id'))
where transaction_type = 'player_cancelled_credit'
  and status = 'completed'
  and metadata->>'original_payment_method' = 'wallet'
  and metadata ? 'original_wallet_transaction_id';

create unique index if not exists wallet_refund_requests_one_active_per_source_credit_uidx
on public.wallet_transactions((metadata->>'source_wallet_transaction_id'))
where transaction_type = 'refund_requested'
  and status in ('pending', 'processing', 'completed')
  and metadata ? 'source_wallet_transaction_id';

create or replace function public.set_player_booking_cancellations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_player_booking_cancellations_updated_at
on public.player_booking_cancellations;

create trigger set_player_booking_cancellations_updated_at
before update on public.player_booking_cancellations
for each row
execute function public.set_player_booking_cancellations_updated_at();

alter table public.player_booking_cancellations enable row level security;

revoke all on public.player_booking_cancellations from public;
revoke all on public.player_booking_cancellations from anon;
revoke all on public.player_booking_cancellations from authenticated;
grant all on public.player_booking_cancellations to service_role;
grant usage, select on sequence public.player_booking_cancellations_id_seq to service_role;

create or replace function public.cancel_player_booking_with_refund_policy(
  p_booking_id bigint,
  p_user_id uuid
)
returns table (
  success boolean,
  booking_id bigint,
  game_id bigint,
  released boolean,
  refund_eligible boolean,
  payment_method text,
  refund_policy text,
  source_credit_transaction_id bigint,
  refund_request_id bigint,
  wallet_restoration_transaction_id bigint,
  amount numeric(10, 2),
  currency text,
  reason text,
  was_full_before_release boolean,
  space_available_after_release boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ambiguous_wallet_booking_payment_count integer := 0;
  v_available_balance numeric(10, 2);
  v_booking public.bookings%rowtype;
  v_booking_count_after integer := 0;
  v_booking_count_before integer := 0;
  v_cancellation public.player_booking_cancellations%rowtype;
  v_currency text := 'GBP';
  v_existing_refund_request public.wallet_transactions%rowtype;
  v_existing_source_credit public.wallet_transactions%rowtype;
  v_game public.games%rowtype;
  v_is_refund_eligible boolean := false;
  v_max_players integer := 0;
  v_non_paid_booking_payment_count integer := 0;
  v_paid_booking_payment public.booking_payments%rowtype;
  v_paid_booking_payment_count integer := 0;
  v_payment_method text := 'legacy';
  v_policy text := 'support_required';
  v_refund_request_id bigint;
  v_source_credit_id bigint;
  v_valid_wallet_booking_payment public.wallet_transactions%rowtype;
  v_valid_wallet_booking_payment_count integer := 0;
  v_wallet_restoration_id bigint;
  v_was_full_before_release boolean := false;
  v_space_available_after_release boolean := false;
begin
  if p_booking_id is null or p_booking_id <= 0 then
    return query select false, p_booking_id, null::bigint, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'invalid_booking'::text, false, false;
    return;
  end if;

  if p_user_id is null then
    return query select false, p_booking_id, null::bigint, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'invalid_user'::text, false, false;
    return;
  end if;

  select *
  into v_cancellation
  from public.player_booking_cancellations
  where player_booking_cancellations.booking_id = p_booking_id
    and player_booking_cancellations.user_id = p_user_id
  for update;

  if v_cancellation.id is not null then
    return query select
      true,
      v_cancellation.booking_id,
      v_cancellation.game_id,
      v_cancellation.status = 'released',
      v_cancellation.refund_policy = 'eligible_24h',
      v_cancellation.payment_method,
      v_cancellation.refund_policy,
      v_cancellation.source_credit_transaction_id,
      v_cancellation.refund_request_id,
      case when v_cancellation.payment_method = 'wallet' then v_cancellation.source_credit_transaction_id else null::bigint end,
      v_cancellation.amount,
      v_cancellation.currency,
      v_cancellation.reason,
      v_cancellation.was_full_before_release,
      v_cancellation.space_available_after_release;
    return;
  end if;

  select *
  into v_booking
  from public.bookings
  where bookings.id = p_booking_id
  for update;

  if v_booking.id is null then
    return query select false, p_booking_id, null::bigint, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'booking_not_found'::text, false, false;
    return;
  end if;

  if v_booking.user_id is distinct from p_user_id then
    return query select false, p_booking_id, v_booking.game_id, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'booking_not_found'::text, false, false;
    return;
  end if;

  select *
  into v_game
  from public.games
  where games.id = v_booking.game_id
  for update;

  if v_game.id is null then
    return query select false, p_booking_id, v_booking.game_id, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'game_not_found'::text, false, false;
    return;
  end if;

  if v_game.starts_at is null then
    return query select false, p_booking_id, v_booking.game_id, false, false, null::text, 'support_required'::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'missing_starts_at'::text, false, false;
    return;
  end if;

  if v_game.starts_at - now() >= interval '24 hours' then
    v_is_refund_eligible := true;
    v_policy := 'eligible_24h';
  else
    v_is_refund_eligible := false;
    v_policy := 'ineligible_within_24h';
  end if;

  select count(*)
  into v_paid_booking_payment_count
  from public.booking_payments
  where booking_payments.booking_id = v_booking.id
    and booking_payments.payment_status = 'paid';

  select count(*)
  into v_non_paid_booking_payment_count
  from public.booking_payments
  where booking_payments.booking_id = v_booking.id
    and booking_payments.payment_status <> 'paid';

  select count(*)
  into v_valid_wallet_booking_payment_count
  from public.wallet_transactions
  where wallet_transactions.booking_id = v_booking.id
    and wallet_transactions.transaction_type = 'wallet_booking_payment'
    and wallet_transactions.status = 'completed'
    and wallet_transactions.amount < 0;

  select count(*)
  into v_ambiguous_wallet_booking_payment_count
  from public.wallet_transactions
  where wallet_transactions.booking_id = v_booking.id
    and wallet_transactions.transaction_type = 'wallet_booking_payment'
    and not (
      wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
    );

  if v_paid_booking_payment_count > 1
    or v_non_paid_booking_payment_count > 0
    or v_valid_wallet_booking_payment_count > 1
    or v_ambiguous_wallet_booking_payment_count > 0
    or (v_paid_booking_payment_count = 1 and v_valid_wallet_booking_payment_count = 1)
  then
    return query select false, v_booking.id, v_booking.game_id, false, false, null::text, 'support_required'::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'booking_has_ambiguous_payment_history'::text, false, false;
    return;
  end if;

  if v_paid_booking_payment_count = 1 then
    select *
    into v_paid_booking_payment
    from public.booking_payments
    where booking_payments.booking_id = v_booking.id
      and booking_payments.payment_status = 'paid'
    for update;

    v_payment_method := 'sumup';
    v_currency := coalesce(nullif(trim(v_paid_booking_payment.currency), ''), 'GBP');
  elsif v_valid_wallet_booking_payment_count = 1 then
    select *
    into v_valid_wallet_booking_payment
    from public.wallet_transactions
    where wallet_transactions.booking_id = v_booking.id
      and wallet_transactions.transaction_type = 'wallet_booking_payment'
      and wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
    for update;

    v_payment_method := 'wallet';
    v_currency := coalesce(nullif(trim(v_valid_wallet_booking_payment.currency), ''), 'GBP');
  else
    return query select false, v_booking.id, v_booking.game_id, false, false, 'legacy'::text, 'support_required'::text, null::bigint, null::bigint, null::bigint, null::numeric(10, 2), null::text, 'booking_has_no_refundable_payment_source'::text, false, false;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(v_currency));

  select games.max_players
  into v_max_players
  from public.games
  where games.id = v_booking.game_id;

  select count(*)
  into v_booking_count_before
  from public.bookings
  where bookings.game_id = v_booking.game_id;

  v_was_full_before_release := v_booking_count_before >= coalesce(v_max_players, 0);

  insert into public.player_booking_cancellations (
    booking_id,
    game_id,
    user_id,
    booking_payment_id,
    wallet_transaction_id,
    payment_method,
    refund_policy,
    status,
    reason,
    amount,
    currency,
    was_full_before_release,
    metadata
  )
  values (
    v_booking.id,
    v_booking.game_id,
    p_user_id,
    case when v_payment_method = 'sumup' then v_paid_booking_payment.id else null::bigint end,
    case when v_payment_method = 'wallet' then v_valid_wallet_booking_payment.id else null::bigint end,
    v_payment_method,
    v_policy,
    'recorded',
    case when v_is_refund_eligible then null::text else 'cancelled_within_24h'::text end,
    case
      when v_payment_method = 'sumup' then v_paid_booking_payment.amount::numeric(10, 2)
      when v_payment_method = 'wallet' then abs(v_valid_wallet_booking_payment.amount)::numeric(10, 2)
      else null::numeric(10, 2)
    end,
    v_currency,
    v_was_full_before_release,
    jsonb_build_object(
      'policy_boundary', 'starts_at_minus_now_gte_24_hours',
      'cancelled_by_user_id', p_user_id
    )
  )
  returning * into v_cancellation;

  if v_is_refund_eligible and v_payment_method = 'sumup' then
    insert into public.wallet_transactions (
      user_id,
      amount,
      idempotency_key,
      currency,
      transaction_type,
      status,
      game_id,
      booking_id,
      payment_id,
      description,
      metadata
    )
    values (
      p_user_id,
      v_paid_booking_payment.amount::numeric(10, 2),
      'player_cancelled_credit:booking:' || v_booking.id::text || ':payment:' || v_paid_booking_payment.id::text,
      v_currency,
      'player_cancelled_credit',
      'completed',
      v_booking.game_id,
      v_booking.id,
      v_paid_booking_payment.id,
      'Credit reserved for player cancellation card refund',
      jsonb_build_object(
        'original_payment_method', 'sumup',
        'original_payment_id', v_paid_booking_payment.id,
        'original_game_id', v_booking.game_id,
        'original_booking_id', v_booking.id,
        'player_booking_cancellation_id', v_cancellation.id,
        'refund_policy', v_policy,
        'reserved_for_card_refund', true
      )
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do update set idempotency_key = excluded.idempotency_key
    returning * into v_existing_source_credit;

    v_source_credit_id := v_existing_source_credit.id;

    select *
    into v_existing_refund_request
    from public.wallet_transactions
    where user_id = p_user_id
      and transaction_type = 'refund_requested'
      and status in ('pending', 'processing', 'completed')
      and metadata->>'source_wallet_transaction_id' = v_source_credit_id::text
    order by created_at asc
    limit 1
    for update;

    if v_existing_refund_request.id is not null then
      v_refund_request_id := v_existing_refund_request.id;
    else
      select balance_breakdown.available_balance
      into v_available_balance
      from public.get_wallet_balance_breakdown(p_user_id, v_currency) as balance_breakdown;

      if v_available_balance < v_paid_booking_payment.amount::numeric(10, 2) then
        raise exception 'Player cancellation SumUp source credit was not available for reservation.';
      end if;

      insert into public.wallet_transactions (
        user_id,
        amount,
        idempotency_key,
        currency,
        transaction_type,
        status,
        game_id,
        booking_id,
        payment_id,
        description,
        metadata
      )
      values (
        p_user_id,
        -v_paid_booking_payment.amount::numeric(10, 2),
        'refund_requested:source_credit:' || v_source_credit_id::text,
        v_currency,
        'refund_requested',
        'pending',
        v_booking.game_id,
        v_booking.id,
        v_paid_booking_payment.id,
        'Refund requested',
        jsonb_build_object(
          'source_wallet_transaction_id', v_source_credit_id,
          'source_transaction_type', 'player_cancelled_credit',
          'original_payment_method', 'sumup',
          'original_payment_id', v_paid_booking_payment.id,
          'original_game_id', v_booking.game_id,
          'original_booking_id', v_booking.id,
          'player_booking_cancellation_id', v_cancellation.id,
          'refund_mode', 'player_cancellation_24h',
          'automatic_refund_eligible', true
        )
      )
      returning id into v_refund_request_id;
    end if;
  elsif v_is_refund_eligible and v_payment_method = 'wallet' then
    insert into public.wallet_transactions (
      user_id,
      amount,
      idempotency_key,
      currency,
      transaction_type,
      status,
      game_id,
      booking_id,
      description,
      metadata
    )
    values (
      p_user_id,
      abs(v_valid_wallet_booking_payment.amount)::numeric(10, 2),
      'player_cancelled_credit:booking:' || v_booking.id::text || ':wallet_transaction:' || v_valid_wallet_booking_payment.id::text,
      v_currency,
      'player_cancelled_credit',
      'completed',
      v_booking.game_id,
      v_booking.id,
      'Wallet credit for player cancellation',
      jsonb_build_object(
        'original_payment_method', 'wallet',
        'original_wallet_transaction_id', v_valid_wallet_booking_payment.id,
        'original_game_id', v_booking.game_id,
        'original_booking_id', v_booking.id,
        'player_booking_cancellation_id', v_cancellation.id,
        'refund_policy', v_policy
      )
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do update set idempotency_key = excluded.idempotency_key
    returning id into v_wallet_restoration_id;

    v_source_credit_id := v_wallet_restoration_id;
  end if;

  delete from public.bookings
  where bookings.id = v_booking.id
    and bookings.user_id = p_user_id;

  if not found then
    raise exception 'Player cancellation booking release failed.';
  end if;

  select count(*)
  into v_booking_count_after
  from public.bookings
  where bookings.game_id = v_booking.game_id;

  v_space_available_after_release := v_was_full_before_release
    and v_booking_count_after < coalesce(v_max_players, 0);

  update public.player_booking_cancellations
  set
    status = 'released',
    source_credit_transaction_id = v_source_credit_id,
    refund_request_id = v_refund_request_id,
    reason = case when v_is_refund_eligible then null::text else 'cancelled_within_24h'::text end,
    space_available_after_release = v_space_available_after_release,
    metadata = coalesce(metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'released_at', now(),
        'source_credit_transaction_id', v_source_credit_id,
        'refund_request_id', v_refund_request_id
      )
  where id = v_cancellation.id
  returning * into v_cancellation;

  return query select
    true,
    v_cancellation.booking_id,
    v_cancellation.game_id,
    true,
    v_cancellation.refund_policy = 'eligible_24h',
    v_cancellation.payment_method,
    v_cancellation.refund_policy,
    v_cancellation.source_credit_transaction_id,
    v_cancellation.refund_request_id,
    case when v_cancellation.payment_method = 'wallet' then v_cancellation.source_credit_transaction_id else null::bigint end,
    v_cancellation.amount,
    v_cancellation.currency,
    v_cancellation.reason,
    v_cancellation.was_full_before_release,
    v_cancellation.space_available_after_release;
end;
$$;

revoke all on function public.cancel_player_booking_with_refund_policy(
  bigint,
  uuid
) from public;
revoke all on function public.cancel_player_booking_with_refund_policy(
  bigint,
  uuid
) from anon;
revoke all on function public.cancel_player_booking_with_refund_policy(
  bigint,
  uuid
) from authenticated;
grant execute on function public.cancel_player_booking_with_refund_policy(
  bigint,
  uuid
) to service_role;
