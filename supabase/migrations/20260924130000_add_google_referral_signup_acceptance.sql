-- Referral Stage 2B: securely attach a referral intent to a genuinely new
-- Google-authenticated Fair Play account. Reward processing remains in the
-- existing verification/unlock reconciliation functions.

create or replace function public.consume_google_referral_signup_intent(
  p_intent_id uuid,
  p_referred_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.referral_signup_intents%rowtype;
  v_user auth.users%rowtype;
begin
  select intent.*
  into v_intent
  from public.referral_signup_intents as intent
  where intent.id = p_intent_id
  for update;

  if not found
    or v_intent.consumed_at is not null
    or v_intent.expires_at <= clock_timestamp() then
    return false;
  end if;

  select auth_user.*
  into v_user
  from auth.users as auth_user
  where auth_user.id = p_referred_user_id;

  if not found
    or v_user.created_at <= v_intent.created_at
    or v_intent.referrer_user_id = v_user.id
    or not exists (
      select 1
      from auth.identities as google_identity
      where google_identity.user_id = v_user.id
        and google_identity.provider = 'google'
    )
    or exists (
      select 1
      from public.referral_relationships as existing_relationship
      where existing_relationship.referred_user_id = v_user.id
    ) then
    return false;
  end if;

  insert into public.referral_relationships (
    referrer_user_id,
    referred_user_id,
    accepted_code_snapshot,
    referrer_reward_idempotency_key,
    referred_reward_unlock_idempotency_key
  )
  values (
    v_intent.referrer_user_id,
    v_user.id,
    v_intent.accepted_code_snapshot,
    'referrer-reward:' || v_user.id::text,
    'referred-reward-unlock:' || v_user.id::text
  )
  on conflict (referred_user_id) do nothing;

  if not found then
    return false;
  end if;

  update public.referral_signup_intents as intent
  set consumed_at = clock_timestamp(),
      consumed_by_user_id = v_user.id
  where intent.id = p_intent_id;

  return true;
end;
$$;

revoke all on function public.consume_google_referral_signup_intent(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.consume_google_referral_signup_intent(uuid, uuid)
to service_role;
