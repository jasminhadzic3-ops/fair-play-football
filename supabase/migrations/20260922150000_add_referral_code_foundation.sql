-- Permanent, server-authoritative personal referral codes.
-- Codes are generated from the player's readable profile name plus a random
-- three-character suffix. Referral acceptance and rewards are intentionally
-- introduced in later stages.

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint referral_codes_uppercase_check
    check (code = upper(code)),
  constraint referral_codes_safe_format_check
    check (code ~ '^[A-Z2-9]{4,15}$')
);

alter table public.referral_codes enable row level security;

revoke all on public.referral_codes from public, anon, authenticated, service_role;

-- One accepted relationship permanently associates a genuinely new player
-- with one referrer. It holds the complete referral reward lifecycle without
-- creating any wallet value itself.
create table if not exists public.referral_relationships (
  id bigint generated always as identity primary key,
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  accepted_code_snapshot text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  email_verification_state text not null default 'pending_verification'
    constraint referral_relationships_email_verification_state_allowed_check
      check (email_verification_state in ('pending_verification', 'verified')),
  email_verified_at timestamptz,
  referrer_reward_amount numeric(10, 2) not null default 5.00
    constraint referral_relationships_referrer_reward_amount_check
      check (referrer_reward_amount = 5.00),
  referrer_reward_state text not null default 'pending_verification'
    constraint referral_relationships_referrer_reward_state_allowed_check
      check (referrer_reward_state in ('pending_verification', 'eligible', 'credited')),
  referrer_reward_wallet_transaction_id bigint unique
    references public.wallet_transactions(id) on delete set null,
  referrer_reward_credited_at timestamptz,
  referrer_reward_idempotency_key text not null unique,
  referred_reward_amount numeric(10, 2) not null default 5.00
    constraint referral_relationships_referred_reward_amount_check
      check (referred_reward_amount = 5.00),
  referred_reward_state text not null default 'pending_verification'
    constraint referral_relationships_referred_reward_state_allowed_check
      check (referred_reward_state in ('pending_verification', 'locked', 'unlocked')),
  referred_reward_locked_at timestamptz,
  referred_reward_unlock_booking_id bigint,
  referred_reward_unlock_game_id bigint,
  referred_reward_wallet_transaction_id bigint unique
    references public.wallet_transactions(id) on delete set null,
  referred_reward_unlocked_at timestamptz,
  referred_reward_unlock_idempotency_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint referral_relationships_not_self_referral
    check (referrer_user_id <> referred_user_id),
  constraint referral_relationships_accepted_code_format_check
    check (
      accepted_code_snapshot = upper(accepted_code_snapshot)
      and accepted_code_snapshot ~ '^[A-Z2-9]{4,15}$'
    ),
  constraint referral_relationships_verification_state_check
    check (
      (email_verification_state = 'pending_verification' and email_verified_at is null)
      or (email_verification_state = 'verified' and email_verified_at is not null)
    ),
  constraint referral_relationships_verified_lifecycle_check
    check (
      (email_verification_state = 'pending_verification'
        and referrer_reward_state = 'pending_verification'
        and referred_reward_state = 'pending_verification')
      or (email_verification_state = 'verified'
        and referrer_reward_state in ('eligible', 'credited')
        and referred_reward_state in ('locked', 'unlocked'))
    ),
  constraint referral_relationships_referrer_reward_state_check
    check (
      (referrer_reward_state = 'pending_verification'
        and referrer_reward_wallet_transaction_id is null
        and referrer_reward_credited_at is null)
      or (referrer_reward_state = 'eligible'
        and email_verification_state = 'verified'
        and referrer_reward_wallet_transaction_id is null
        and referrer_reward_credited_at is null)
      or (referrer_reward_state = 'credited'
        and email_verification_state = 'verified'
        and referrer_reward_wallet_transaction_id is not null
        and referrer_reward_credited_at is not null)
    ),
  constraint referral_relationships_referred_reward_state_check
    check (
      (referred_reward_state = 'pending_verification'
        and referred_reward_locked_at is null
        and referred_reward_unlock_booking_id is null
        and referred_reward_unlock_game_id is null
        and referred_reward_wallet_transaction_id is null
        and referred_reward_unlocked_at is null)
      or (referred_reward_state = 'locked'
        and email_verification_state = 'verified'
        and referred_reward_locked_at is not null
        and referred_reward_unlock_booking_id is null
        and referred_reward_unlock_game_id is null
        and referred_reward_wallet_transaction_id is null
        and referred_reward_unlocked_at is null)
      or (referred_reward_state = 'unlocked'
        and email_verification_state = 'verified'
        and referred_reward_locked_at is not null
        and referred_reward_unlock_booking_id is not null
        and referred_reward_unlock_game_id is not null
        and referred_reward_wallet_transaction_id is not null
        and referred_reward_unlocked_at is not null)
    )
);

comment on column public.referral_relationships.referred_reward_unlock_booking_id is
'Immutable historical booking identifier that unlocked the referred player reward. It intentionally has no restrictive booking foreign key so cancellation cleanup cannot erase the audit reference.';

comment on column public.referral_relationships.referred_reward_unlock_game_id is
'Immutable historical game identifier captured with the qualifying attended booking that unlocked the referred player reward.';

create index if not exists referral_relationships_referrer_user_idx
  on public.referral_relationships(referrer_user_id, created_at desc);

create index if not exists referral_relationships_referred_reward_unlock_booking_idx
  on public.referral_relationships(referred_reward_unlock_booking_id)
  where referred_reward_unlock_booking_id is not null;

alter table public.referral_relationships enable row level security;

revoke all on public.referral_relationships from public, anon, authenticated, service_role;

create or replace function public.set_referral_relationships_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists set_referral_relationships_updated_at on public.referral_relationships;

create trigger set_referral_relationships_updated_at
before update on public.referral_relationships
for each row
execute function public.set_referral_relationships_updated_at();

create or replace function public.referral_code_prefix(
  p_username text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_first_name text;
  v_prefix text;
begin
  -- profiles.username is the project's existing readable player-name field.
  -- Keep only a safe ASCII token for a code; a generic prefix is preferable
  -- to preserving unsafe, ambiguous, or empty characters.
  v_first_name := split_part(
    regexp_replace(btrim(coalesce(p_username, '')), '\s+', ' ', 'g'),
    ' ',
    1
  );
  v_prefix := upper(regexp_replace(coalesce(v_first_name, ''), '[^A-Za-z]', '', 'g'));

  if length(v_prefix) < 1 then
    return 'PLAYER';
  end if;

  return left(v_prefix, 12);
end;
$$;

create or replace function public.ensure_referral_code(
  p_user_id uuid,
  p_username text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_suffix_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_random_bytes bytea;
  v_random_value integer;
  v_candidate text;
  v_existing_code text;
  v_attempt integer;
begin
  if p_user_id is null then
    raise exception 'Referral code user is required';
  end if;

  select referral_code.code
  into v_existing_code
  from public.referral_codes as referral_code
  where referral_code.user_id = p_user_id;

  if v_existing_code is not null then
    return v_existing_code;
  end if;

  v_prefix := public.referral_code_prefix(p_username);

  for v_attempt in 1..100 loop
    -- gen_random_uuid() supplies cryptographically secure random UUID v4
    -- entropy. Encode three independent five-bit values with an alphabet
    -- which excludes O/0 and I/1.
    v_random_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_random_value :=
      (get_byte(v_random_bytes, 0) << 16)
      + (get_byte(v_random_bytes, 1) << 8)
      + get_byte(v_random_bytes, 2);
    v_candidate := v_prefix
      || substr(v_suffix_alphabet, ((v_random_value >> 10) & 31) + 1, 1)
      || substr(v_suffix_alphabet, ((v_random_value >> 5) & 31) + 1, 1)
      || substr(v_suffix_alphabet, (v_random_value & 31) + 1, 1);

    insert into public.referral_codes (user_id, code)
    values (p_user_id, v_candidate)
    on conflict do nothing
    returning code into v_existing_code;

    if v_existing_code is not null then
      return v_existing_code;
    end if;

    -- A concurrent attempt for this user may have won the primary-key race.
    select referral_code.code
    into v_existing_code
    from public.referral_codes as referral_code
    where referral_code.user_id = p_user_id;

    if v_existing_code is not null then
      return v_existing_code;
    end if;
  end loop;

  raise exception 'Unable to generate a unique referral code';
end;
$$;

create or replace function public.create_referral_code_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_referral_code(new.id, new.username);
  return new;
end;
$$;

drop trigger if exists create_referral_code_after_profile_insert on public.profiles;

create trigger create_referral_code_after_profile_insert
after insert on public.profiles
for each row
execute function public.create_referral_code_for_profile();

-- Backfill exactly one immutable code for every existing player profile.
do $$
declare
  v_profile record;
begin
  for v_profile in
    select profile.id, profile.username
    from public.profiles as profile
  loop
    perform public.ensure_referral_code(v_profile.id, v_profile.username);
  end loop;
end;
$$;

create or replace function public.get_my_referral_code()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select referral_code.code
  into v_code
  from public.referral_codes as referral_code
  where referral_code.user_id = v_user_id;

  return v_code;
end;
$$;

revoke all on function public.referral_code_prefix(text) from public, anon, authenticated, service_role;
revoke all on function public.ensure_referral_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.create_referral_code_for_profile() from public, anon, authenticated, service_role;
revoke all on function public.set_referral_relationships_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.get_my_referral_code() from public, anon, service_role;
grant execute on function public.get_my_referral_code() to authenticated;
