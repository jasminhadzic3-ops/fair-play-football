-- Referral Stage 4: unlock the referred player's already-locked £5 reward
-- after the first retained, direct Fair Play paid booking reaches the referral
-- settlement point. Attendance is intentionally not part of this rule.

-- Referral settlement is deliberately independent from Loyalty. Loyalty keeps
-- its own one-hour completion delay; referred-player rewards settle two hours
-- after kickoff.
create table if not exists public.referral_config (
  id boolean primary key default true check (id),
  completion_delay interval not null default interval '2 hours'
    check (completion_delay > interval '0')
);

insert into public.referral_config (id, completion_delay)
values (true, interval '2 hours')
on conflict (id) do nothing;

alter table public.referral_config enable row level security;

revoke all on public.referral_config from public, anon, authenticated, service_role;

create index if not exists referral_relationships_locked_reward_idx
  on public.referral_relationships (id)
  where referred_reward_state = 'locked'
    and referred_reward_wallet_transaction_id is null
    and referred_reward_unlocked_at is null;

create or replace function public.reconcile_referral_reward_unlocks(
  p_relationship_limit integer default 100
)
returns table (
  relationships_checked integer,
  referrals_unlocked integer,
  wallet_credits_issued integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relationship record;
  v_candidate record;
  v_revalidated_candidate record;
  v_wallet_transaction public.wallet_transactions%rowtype;
  v_referral_completion_delay interval;
  v_credit_success boolean;
  v_wallet_transaction_id bigint;
  v_relationships_checked integer := 0;
  v_referrals_unlocked integer := 0;
  v_wallet_credits_issued integer := 0;
begin
  if p_relationship_limit is null then
    p_relationship_limit := 100;
  end if;

  if p_relationship_limit < 1 or p_relationship_limit > 500 then
    raise exception 'Invalid referral relationship limit';
  end if;

  select config.completion_delay
  into v_referral_completion_delay
  from public.referral_config as config
  where config.id = true;

  if v_referral_completion_delay is null then
    raise exception 'Referral completion delay is missing';
  end if;

  for v_relationship in
    select
      relationship.id as relationship_id,
      relationship.referred_user_id,
      relationship.accepted_at,
      relationship.referred_reward_amount,
      relationship.referred_reward_locked_at,
      relationship.referred_reward_unlock_idempotency_key
    from public.referral_relationships as relationship
    where relationship.email_verification_state = 'verified'
      and relationship.referrer_reward_state = 'credited'
      and relationship.referred_reward_state = 'locked'
      and relationship.referred_reward_locked_at is not null
      and relationship.referred_reward_wallet_transaction_id is null
      and relationship.referred_reward_unlocked_at is null
      and relationship.referred_reward_unlock_booking_id is null
      and relationship.referred_reward_unlock_game_id is null
    order by relationship.id
    limit p_relationship_limit
    for update of relationship skip locked
  loop
    v_relationships_checked := v_relationships_checked + 1;

    if v_relationship.referred_reward_amount <> 5.00
      or v_relationship.referred_reward_unlock_idempotency_key
        <> 'referred-reward-unlock:' || v_relationship.referred_user_id::text
    then
      raise exception 'Referral relationship % has invalid unlock reward data',
        v_relationship.relationship_id;
    end if;

    -- Lock the deterministically first eligible booking before the fresh
    -- revalidation below. Physical attendance data is not used or mutated.
    select
      booking.id as booking_id,
      booking.game_id,
      payment.id as payment_id
    into v_candidate
    from public.bookings as booking
    join public.games as game
      on game.id = booking.game_id
    join public.booking_payments as payment
      on payment.booking_id = booking.id
    where booking.user_id = v_relationship.referred_user_id
      and booking.booking_source = 'fair_play'
      and booking.created_at >= v_relationship.accepted_at
      and game.status = 'active'
      and game.starts_at >= v_relationship.referred_reward_locked_at
      and game.starts_at <= clock_timestamp() - v_referral_completion_delay
      and payment.user_id = booking.user_id
      and payment.game_id = booking.game_id
      and payment.payment_status = 'paid'
      and payment.amount > 0
      and not exists (
        select 1
        from public.booking_payments as other_payment
        where other_payment.booking_id = booking.id
          and other_payment.payment_status = 'paid'
          and other_payment.id <> payment.id
      )
      and not exists (
        select 1
        from public.wallet_transactions as wallet_payment
        where wallet_payment.booking_id = booking.id
          and wallet_payment.transaction_type = 'wallet_booking_payment'
          and wallet_payment.status = 'completed'
          and wallet_payment.amount < 0
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
          and returned_value.transaction_type in (
            'game_cancelled_credit',
            'player_cancelled_credit',
            'refund_completed'
          )
      )
      and not exists (
        select 1
        from public.loyalty_booking_ineligibility as ineligible
        where ineligible.booking_id = booking.id
      )
    order by game.starts_at asc, booking.id asc
    limit 1
    for update of booking;

    if not found then
      continue;
    end if;

    -- A separate READ COMMITTED statement after the booking lock prevents a
    -- stale candidate snapshot from bypassing returned-value/cancellation data.
    select
      booking.id as booking_id,
      booking.game_id,
      payment.id as payment_id
    into v_revalidated_candidate
    from public.bookings as booking
    join public.games as game
      on game.id = booking.game_id
    join public.booking_payments as payment
      on payment.booking_id = booking.id
    where booking.id = v_candidate.booking_id
      and payment.id = v_candidate.payment_id
      and booking.user_id = v_relationship.referred_user_id
      and booking.booking_source = 'fair_play'
      and booking.created_at >= v_relationship.accepted_at
      and game.status = 'active'
      and game.starts_at >= v_relationship.referred_reward_locked_at
      and game.starts_at <= clock_timestamp() - v_referral_completion_delay
      and payment.user_id = booking.user_id
      and payment.game_id = booking.game_id
      and payment.payment_status = 'paid'
      and payment.amount > 0
      and not exists (
        select 1
        from public.booking_payments as other_payment
        where other_payment.booking_id = booking.id
          and other_payment.payment_status = 'paid'
          and other_payment.id <> payment.id
      )
      and not exists (
        select 1
        from public.wallet_transactions as wallet_payment
        where wallet_payment.booking_id = booking.id
          and wallet_payment.transaction_type = 'wallet_booking_payment'
          and wallet_payment.status = 'completed'
          and wallet_payment.amount < 0
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
          and returned_value.transaction_type in (
            'game_cancelled_credit',
            'player_cancelled_credit',
            'refund_completed'
          )
      )
      and not exists (
        select 1
        from public.loyalty_booking_ineligibility as ineligible
        where ineligible.booking_id = booking.id
      );

    if not found then
      continue;
    end if;

    select credit.success, credit.transaction_id
    into v_credit_success, v_wallet_transaction_id
    from public.create_wallet_credit_once(
      p_user_id => v_relationship.referred_user_id,
      p_amount => v_relationship.referred_reward_amount,
      p_currency => 'GBP',
      p_transaction_type => 'promotion_bonus',
      p_idempotency_key => v_relationship.referred_reward_unlock_idempotency_key,
      p_game_id => v_revalidated_candidate.game_id,
      p_booking_id => v_revalidated_candidate.booking_id,
      p_payment_id => v_revalidated_candidate.payment_id,
      p_description => 'Fair Play referral reward unlocked',
      p_metadata => jsonb_build_object(
        'referral_relationship_id', v_relationship.relationship_id,
        'unlock_booking_id', v_revalidated_candidate.booking_id,
        'unlock_game_id', v_revalidated_candidate.game_id,
        'unlock_payment_id', v_revalidated_candidate.payment_id
      )
    ) as credit;

    if not coalesce(v_credit_success, false)
      or v_wallet_transaction_id is null then
      raise exception 'Unable to unlock referral reward for relationship %',
        v_relationship.relationship_id;
    end if;

    select wallet_transaction.*
    into v_wallet_transaction
    from public.wallet_transactions as wallet_transaction
    where wallet_transaction.id = v_wallet_transaction_id
    for update;

    if v_wallet_transaction.id is null
      or v_wallet_transaction.user_id is distinct from v_relationship.referred_user_id
      or v_wallet_transaction.amount is distinct from v_relationship.referred_reward_amount
      or v_wallet_transaction.currency is distinct from 'GBP'
      or v_wallet_transaction.transaction_type is distinct from 'promotion_bonus'
      or v_wallet_transaction.status is distinct from 'completed'
      or v_wallet_transaction.idempotency_key
        is distinct from v_relationship.referred_reward_unlock_idempotency_key
      or v_wallet_transaction.booking_id is distinct from v_revalidated_candidate.booking_id
      or v_wallet_transaction.game_id is distinct from v_revalidated_candidate.game_id
      or v_wallet_transaction.payment_id is distinct from v_revalidated_candidate.payment_id
      or v_wallet_transaction.metadata ->> 'referral_relationship_id'
        is distinct from v_relationship.relationship_id::text
      or v_wallet_transaction.metadata ->> 'unlock_booking_id'
        is distinct from v_revalidated_candidate.booking_id::text
      or v_wallet_transaction.metadata ->> 'unlock_game_id'
        is distinct from v_revalidated_candidate.game_id::text
      or v_wallet_transaction.metadata ->> 'unlock_payment_id'
        is distinct from v_revalidated_candidate.payment_id::text
    then
      raise exception 'Referral reward wallet transaction conflicts for relationship %',
        v_relationship.relationship_id;
    end if;

    update public.referral_relationships as relationship
    set referred_reward_state = 'unlocked',
        referred_reward_wallet_transaction_id = v_wallet_transaction_id,
        referred_reward_unlocked_at = clock_timestamp(),
        referred_reward_unlock_booking_id = v_revalidated_candidate.booking_id,
        referred_reward_unlock_game_id = v_revalidated_candidate.game_id
    where relationship.id = v_relationship.relationship_id
      and relationship.referred_reward_state = 'locked'
      and relationship.referred_reward_wallet_transaction_id is null
      and relationship.referred_reward_unlocked_at is null
      and relationship.referred_reward_unlock_booking_id is null
      and relationship.referred_reward_unlock_game_id is null;

    if not found then
      raise exception 'Referral relationship changed during reward unlock: %',
        v_relationship.relationship_id;
    end if;

    v_referrals_unlocked := v_referrals_unlocked + 1;
    v_wallet_credits_issued := v_wallet_credits_issued + 1;
  end loop;

  return query
  select
    v_relationships_checked,
    v_referrals_unlocked,
    v_wallet_credits_issued;
end;
$$;

revoke all on function public.reconcile_referral_reward_unlocks(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_referral_reward_unlocks(integer)
  to service_role;
