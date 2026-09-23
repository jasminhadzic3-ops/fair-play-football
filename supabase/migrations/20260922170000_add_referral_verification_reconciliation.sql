-- Referral Stage 3: reconcile verified email referrals and issue the referrer's
-- spendable credit. The referred player's reward remains locked in the
-- relationship until the later attendance-unlock stage.

create index if not exists referral_relationships_pending_verification_idx
  on public.referral_relationships (id)
  where email_verification_state = 'pending_verification';

create or replace function public.reconcile_referral_verifications(
  p_relationship_limit integer default 100
)
returns table (
  relationships_checked integer,
  referrals_processed integer,
  wallet_credits_issued integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relationship record;
  v_email_confirmed_at timestamptz;
  v_credit_success boolean;
  v_wallet_transaction_id bigint;
  v_relationships_checked integer := 0;
  v_referrals_processed integer := 0;
  v_wallet_credits_issued integer := 0;
begin
  if p_relationship_limit is null then
    p_relationship_limit := 100;
  end if;

  if p_relationship_limit < 1 or p_relationship_limit > 500 then
    raise exception 'Invalid referral relationship limit';
  end if;

  for v_relationship in
    select
      relationship.id as relationship_id,
      relationship.referrer_user_id,
      relationship.referred_user_id,
      relationship.referrer_reward_idempotency_key
    from public.referral_relationships as relationship
    join auth.users as auth_user
      on auth_user.id = relationship.referred_user_id
    where relationship.email_verification_state = 'pending_verification'
      and relationship.referrer_reward_state = 'pending_verification'
      and relationship.referred_reward_state = 'pending_verification'
      and auth_user.email_confirmed_at is not null
    order by relationship.id
    limit p_relationship_limit
    for update of relationship skip locked
  loop
    v_relationships_checked := v_relationships_checked + 1;

    -- Re-read the authoritative Auth value after the relationship lock.
    select auth_user.email_confirmed_at
    into v_email_confirmed_at
    from auth.users as auth_user
    where auth_user.id = v_relationship.referred_user_id;

    if v_email_confirmed_at is null then
      continue;
    end if;

    select credit.success, credit.transaction_id
    into v_credit_success, v_wallet_transaction_id
    from public.create_wallet_credit_once(
      p_user_id => v_relationship.referrer_user_id,
      p_amount => 5.00,
      p_currency => 'GBP',
      p_transaction_type => 'promotion_bonus',
      p_idempotency_key => v_relationship.referrer_reward_idempotency_key,
      p_description => 'Fair Play referral reward',
      p_metadata => jsonb_build_object(
        'referral_relationship_id', v_relationship.relationship_id,
        'referred_user_id', v_relationship.referred_user_id
      )
    ) as credit;

    if not coalesce(v_credit_success, false)
      or v_wallet_transaction_id is null then
      raise exception 'Unable to issue referral wallet credit for relationship %',
        v_relationship.relationship_id;
    end if;

    update public.referral_relationships as relationship
    set email_verification_state = 'verified',
        email_verified_at = v_email_confirmed_at,
        referrer_reward_state = 'credited',
        referrer_reward_wallet_transaction_id = v_wallet_transaction_id,
        referrer_reward_credited_at = clock_timestamp(),
        referred_reward_state = 'locked',
        referred_reward_locked_at = clock_timestamp()
    where relationship.id = v_relationship.relationship_id
      and relationship.email_verification_state = 'pending_verification'
      and relationship.referrer_reward_state = 'pending_verification'
      and relationship.referred_reward_state = 'pending_verification';

    if not found then
      raise exception 'Referral relationship changed during reconciliation: %',
        v_relationship.relationship_id;
    end if;

    v_referrals_processed := v_referrals_processed + 1;
    v_wallet_credits_issued := v_wallet_credits_issued + 1;
  end loop;

  return query
  select
    v_relationships_checked,
    v_referrals_processed,
    v_wallet_credits_issued;
end;
$$;

revoke all on function public.reconcile_referral_verifications(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_referral_verifications(integer)
  to service_role;
