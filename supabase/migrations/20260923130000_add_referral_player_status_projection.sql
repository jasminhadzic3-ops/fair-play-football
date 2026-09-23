-- Player-facing referral reward status projection.
--
-- The candidate helper owns the retained-payment predicate used by both the
-- financial reconciliation and the authenticated read projection. The helper
-- remains private so no client can inspect bookings, payments, or relationships.

create or replace function public.find_referral_reward_candidate(
  p_referred_user_id uuid,
  p_accepted_at timestamptz,
  p_referred_reward_locked_at timestamptz,
  p_referral_completion_delay interval,
  p_require_settlement boolean,
  p_booking_id bigint default null,
  p_payment_id bigint default null,
  p_lock_booking boolean default false
)
returns table (
  booking_id bigint,
  game_id bigint,
  payment_id bigint,
  eligible_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_query text := $query$
    select
      booking.id as booking_id,
      booking.game_id,
      payment.id as payment_id,
      game.starts_at + $4 as eligible_at
    from public.bookings as booking
    join public.games as game
      on game.id = booking.game_id
    join public.booking_payments as payment
      on payment.booking_id = booking.id
    where booking.user_id = $1
      and booking.booking_source = 'fair_play'
      and booking.created_at >= $2
      and game.status = 'active'
      and game.starts_at >= $3
      and (
        (
          $5
          and game.starts_at <= clock_timestamp() - $4
        )
        or (
          not $5
          and game.starts_at <= clock_timestamp()
        )
      )
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
      and ($6 is null or booking.id = $6)
      and ($7 is null or payment.id = $7)
    order by game.starts_at asc, booking.id asc
    limit 1
  $query$;
begin
  if p_lock_booking then
    v_query := v_query || ' for update of booking';
  end if;

  return query execute v_query
  using
    p_referred_user_id,
    p_accepted_at,
    p_referred_reward_locked_at,
    p_referral_completion_delay,
    p_require_settlement,
    p_booking_id,
    p_payment_id;
end;
$$;

revoke all on function public.find_referral_reward_candidate(
  uuid,
  timestamptz,
  timestamptz,
  interval,
  boolean,
  bigint,
  bigint,
  boolean
) from public, anon, authenticated, service_role;

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

    -- The helper locks the deterministically first settled candidate. A fresh
    -- statement below revalidates it after the booking lock is held.
    select
      candidate.booking_id,
      candidate.game_id,
      candidate.payment_id
    into v_candidate
    from public.find_referral_reward_candidate(
      p_referred_user_id => v_relationship.referred_user_id,
      p_accepted_at => v_relationship.accepted_at,
      p_referred_reward_locked_at => v_relationship.referred_reward_locked_at,
      p_referral_completion_delay => v_referral_completion_delay,
      p_require_settlement => true,
      p_lock_booking => true
    ) as candidate;

    if not found then
      continue;
    end if;

    -- A separate READ COMMITTED statement after the booking lock prevents a
    -- stale candidate snapshot from bypassing returned-value/cancellation data.
    select
      candidate.booking_id,
      candidate.game_id,
      candidate.payment_id
    into v_revalidated_candidate
    from public.find_referral_reward_candidate(
      p_referred_user_id => v_relationship.referred_user_id,
      p_accepted_at => v_relationship.accepted_at,
      p_referred_reward_locked_at => v_relationship.referred_reward_locked_at,
      p_referral_completion_delay => v_referral_completion_delay,
      p_require_settlement => true,
      p_booking_id => v_candidate.booking_id,
      p_payment_id => v_candidate.payment_id,
      p_lock_booking => false
    ) as candidate;

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
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_referral_reward_unlocks(integer)
  to service_role;

create or replace function public.get_my_referral_reward_status()
returns table (
  referral_code text,
  has_referred_reward boolean,
  referred_reward_state text,
  referred_reward_amount numeric(10, 2),
  qualifying_game_found boolean,
  eligible_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_referral_code text;
  v_relationship record;
  v_referral_completion_delay interval;
  v_eligible_at timestamptz;
  v_qualifying_game_found boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select referral_code.code
  into v_referral_code
  from public.referral_codes as referral_code
  where referral_code.user_id = v_user_id;

  select
    relationship.email_verification_state,
    relationship.referrer_reward_state,
    relationship.referred_reward_state,
    relationship.referred_reward_amount,
    relationship.accepted_at,
    relationship.referred_reward_locked_at,
    relationship.referred_reward_wallet_transaction_id,
    relationship.referred_reward_unlocked_at,
    relationship.referred_reward_unlock_booking_id,
    relationship.referred_reward_unlock_game_id
  into v_relationship
  from public.referral_relationships as relationship
  where relationship.referred_user_id = v_user_id;

  if not found then
    return query
    select
      v_referral_code,
      false,
      null::text,
      null::numeric(10, 2),
      false,
      null::timestamptz;
    return;
  end if;

  if v_relationship.referred_reward_state = 'unlocked' then
    v_qualifying_game_found := true;
  elsif v_relationship.email_verification_state = 'verified'
    and v_relationship.referrer_reward_state = 'credited'
    and v_relationship.referred_reward_state = 'locked'
    and v_relationship.referred_reward_locked_at is not null
    and v_relationship.referred_reward_wallet_transaction_id is null
    and v_relationship.referred_reward_unlocked_at is null
    and v_relationship.referred_reward_unlock_booking_id is null
    and v_relationship.referred_reward_unlock_game_id is null then
    select config.completion_delay
    into v_referral_completion_delay
    from public.referral_config as config
    where config.id = true;

    if v_referral_completion_delay is null then
      raise exception 'Referral completion delay is missing';
    end if;

    select candidate.eligible_at
    into v_eligible_at
    from public.find_referral_reward_candidate(
      p_referred_user_id => v_user_id,
      p_accepted_at => v_relationship.accepted_at,
      p_referred_reward_locked_at => v_relationship.referred_reward_locked_at,
      p_referral_completion_delay => v_referral_completion_delay,
      p_require_settlement => false,
      p_lock_booking => false
    ) as candidate;

    v_qualifying_game_found := found;
  end if;

  return query
  select
    v_referral_code,
    true,
    v_relationship.referred_reward_state,
    v_relationship.referred_reward_amount,
    v_qualifying_game_found,
    v_eligible_at;
end;
$$;

revoke all on function public.get_my_referral_reward_status()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_referral_reward_status() to authenticated;