-- Referral Stage 2A: secure acceptance for new email/password signups.
-- Google referral acceptance is intentionally deferred until a server OAuth
-- callback/session architecture is introduced.

create table if not exists public.referral_signup_intents (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  accepted_code_snapshot text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  consumed_at timestamptz,
  consumed_by_user_id uuid references auth.users(id) on delete set null,
  constraint referral_signup_intents_code_format_check
    check (
      accepted_code_snapshot = upper(accepted_code_snapshot)
      and accepted_code_snapshot ~ '^[A-Z2-9]{4,15}$'
    ),
  constraint referral_signup_intents_expiry_check
    check (expires_at > created_at),
  constraint referral_signup_intents_consumption_check
    check ((consumed_at is null and consumed_by_user_id is null)
      or (consumed_at is not null and consumed_by_user_id is not null))
);

alter table public.referral_signup_intents enable row level security;
revoke all on public.referral_signup_intents from public, anon, authenticated, service_role;

create index if not exists referral_signup_intents_expiry_idx
  on public.referral_signup_intents(expires_at);

create or replace function public.validate_referral_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.referral_codes as referral_code
    where referral_code.code = upper(btrim(coalesce(p_code, '')))
  );
$$;

create or replace function public.create_referral_signup_intent(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_referrer_user_id uuid;
  v_intent_id uuid;
begin
  if v_code = '' or v_code !~ '^[A-Z2-9]{4,15}$' then
    return null;
  end if;

  select referral_code.user_id
  into v_referrer_user_id
  from public.referral_codes as referral_code
  where referral_code.code = v_code;

  if v_referrer_user_id is null then
    return null;
  end if;

  insert into public.referral_signup_intents (
    referrer_user_id,
    accepted_code_snapshot
  )
  values (
    v_referrer_user_id,
    v_code
  )
  returning id into v_intent_id;

  return v_intent_id;
end;
$$;

create or replace function public.create_referral_relationship_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent_id uuid;
  v_intent public.referral_signup_intents%rowtype;
begin
  v_intent_id := nullif(new.raw_user_meta_data ->> 'referral_signup_intent_id', '')::uuid;

  if v_intent_id is null then
    return new;
  end if;

  select intent.*
  into v_intent
  from public.referral_signup_intents as intent
  where intent.id = v_intent_id
  for update;

  if not found
    or v_intent.consumed_at is not null
    or v_intent.expires_at <= clock_timestamp() then
    raise exception 'Referral code could not be applied.' using errcode = 'P0001';
  end if;

  if v_intent.referrer_user_id = new.id then
    raise exception 'Referral code could not be applied.' using errcode = 'P0001';
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
    new.id,
    v_intent.accepted_code_snapshot,
    'referrer-reward:' || new.id::text,
    'referred-reward-unlock:' || new.id::text
  )
  on conflict (referred_user_id) do nothing;

  update public.referral_signup_intents as intent
  set consumed_at = clock_timestamp(),
      consumed_by_user_id = new.id
  where intent.id = v_intent_id;

  return new;
end;
$$;

drop trigger if exists create_referral_relationship_after_auth_insert on auth.users;

create trigger create_referral_relationship_after_auth_insert
after insert on auth.users
for each row
execute function public.create_referral_relationship_for_new_auth_user();

revoke all on function public.validate_referral_code(text) from public, service_role;
grant execute on function public.validate_referral_code(text) to anon, authenticated;

revoke all on function public.create_referral_signup_intent(text) from public, service_role;
grant execute on function public.create_referral_signup_intent(text) to anon, authenticated;

revoke all on function public.create_referral_relationship_for_new_auth_user() from public, anon, authenticated, service_role;
