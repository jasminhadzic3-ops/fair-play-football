-- Fair Play Football base public schema.
-- Run this first on a fresh Supabase project before the feature-specific SQL files.
-- This intentionally does not create RLS policies; apply supabase/rls_policies.sql
-- after this file.

create table if not exists public.profiles (
  id uuid not null,
  email text,
  username text,
  age text,
  gender text,
  favourite_position text,
  created_at timestamptz default now(),
  avatar_url text,
  terms_accepted_at timestamptz,
  terms_version text
);

comment on column public.profiles.terms_accepted_at is
'Timestamp when the user accepted the Fair Play Football Terms of Service and Privacy Policy during signup. Existing users may be null.';

comment on column public.profiles.terms_version is
'Terms/Privacy version accepted by the user during signup. Existing users may be null.';

create table if not exists public.games (
  title text not null,
  location text not null,
  time text,
  price bigint,
  spots_left bigint,
  starts_at timestamptz,
  created_at timestamptz default now(),
  id bigint not null,
  max_players integer default 16,
  status text not null default 'active',
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  archived_at timestamptz,
  archived_by uuid
);

comment on column public.games.starts_at is
'Canonical timezone-aware kickoff timestamp for scheduling and reminder logic.';

comment on column public.games.time is
'Legacy display compatibility field during the starts_at transition; do not use for reminder scheduling.';

comment on column public.games.archived_at is
'Canonical archive flag. Archive is separate from active/cancelled lifecycle status and must never delete or rewrite financial/history records.';

comment on column public.games.archived_by is
'Admin user who archived the game when available; archiving must never delete or rewrite financial/history records.';

create table if not exists public.bookings (
  id bigint not null,
  created_at timestamptz not null default now(),
  player_name text,
  game_id bigint,
  user_id uuid default auth.uid()
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
  payment_method text not null,
  refund_policy text not null,
  status text not null default 'recorded',
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

create table if not exists public.email_deliveries (
  id bigint generated always as identity primary key,
  delivery_key text not null,
  email_type text not null,
  recipient_key text not null,
  booking_id bigint,
  game_id bigint,
  status text not null default 'sending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  sanitized_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_deliveries is
'Server-only durable delivery ledger for operational emails. The delivery_key is the duplicate-protection boundary.';

comment on column public.email_deliveries.recipient_key is
'Stable non-email recipient key such as an auth user id or hashed test recipient identifier. Do not store recipient email addresses or names.';

comment on column public.email_deliveries.sanitized_error_message is
'Sanitized diagnostic message only; never store raw provider payloads, names, emails, tokens, or personal data.';

comment on column public.email_deliveries.metadata is
'Sanitized operational metadata only. Do not store names, emails, provider payloads, tokens, or personal data.';

do $$
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.games'::regclass
      and attname = 'id'
      and attidentity = ''
  ) then
    alter table public.games
    alter column id add generated by default as identity;
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.bookings'::regclass
      and attname = 'id'
      and attidentity = ''
  ) then
    alter table public.bookings
    alter column id add generated by default as identity;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'player_booking_cancellations_payment_method_check'
      and conrelid = 'public.player_booking_cancellations'::regclass
  ) then
    alter table public.player_booking_cancellations
    add constraint player_booking_cancellations_payment_method_check
    check (payment_method in ('sumup', 'wallet', 'legacy'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'player_booking_cancellations_refund_policy_check'
      and conrelid = 'public.player_booking_cancellations'::regclass
  ) then
    alter table public.player_booking_cancellations
    add constraint player_booking_cancellations_refund_policy_check
    check (refund_policy in ('eligible_24h', 'ineligible_within_24h', 'support_required'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'player_booking_cancellations_status_check'
      and conrelid = 'public.player_booking_cancellations'::regclass
  ) then
    alter table public.player_booking_cancellations
    add constraint player_booking_cancellations_status_check
    check (status in ('recorded', 'released', 'blocked'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'email_deliveries_type_check'
      and conrelid = 'public.email_deliveries'::regclass
  ) then
    alter table public.email_deliveries
    add constraint email_deliveries_type_check
    check (email_type in ('booking_confirmation', 'game_half_full'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'email_deliveries_status_check'
      and conrelid = 'public.email_deliveries'::regclass
  ) then
    alter table public.email_deliveries
    add constraint email_deliveries_status_check
    check (status in ('sending', 'sent', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'email_deliveries_attempts_check'
      and conrelid = 'public.email_deliveries'::regclass
  ) then
    alter table public.email_deliveries
    add constraint email_deliveries_attempts_check
    check (attempts >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'email_deliveries_sent_at_check'
      and conrelid = 'public.email_deliveries'::regclass
  ) then
    alter table public.email_deliveries
    add constraint email_deliveries_sent_at_check
    check (
      (status = 'sent' and sent_at is not null)
      or (status <> 'sent')
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_pkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_pkey'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
    add constraint games_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_pkey'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
    add constraint bookings_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_id_fkey
    foreign key (id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_user_id_fkey'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
    add constraint bookings_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_cancelled_by_fkey'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
    add constraint games_cancelled_by_fkey
    foreign key (cancelled_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_archived_by_fkey'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
    add constraint games_archived_by_fkey
    foreign key (archived_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_status_check'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
    add constraint games_status_check
    check (status in ('active', 'cancelled'));
  end if;
end $$;

create index if not exists games_status_idx
on public.games(status);

create index if not exists games_archived_at_idx
on public.games(archived_at)
where archived_at is not null;

create index if not exists games_active_unarchived_starts_at_idx
on public.games(starts_at)
where status = 'active'
  and archived_at is null;

create index if not exists games_archived_lookup_idx
on public.games(archived_at, id)
where archived_at is not null;

create unique index if not exists player_booking_cancellations_one_per_booking_uidx
on public.player_booking_cancellations(booking_id);

create index if not exists player_booking_cancellations_user_created_idx
on public.player_booking_cancellations(user_id, created_at desc);

create index if not exists player_booking_cancellations_game_created_idx
on public.player_booking_cancellations(game_id, created_at desc);

create unique index if not exists email_deliveries_delivery_key_uidx
on public.email_deliveries(delivery_key);

create index if not exists email_deliveries_type_status_idx
on public.email_deliveries(email_type, status, updated_at desc);

create index if not exists email_deliveries_booking_id_idx
on public.email_deliveries(booking_id)
where booking_id is not null;

create index if not exists email_deliveries_game_id_idx
on public.email_deliveries(game_id)
where game_id is not null;

do $$
begin
  if to_regclass('public.wallet_transactions') is not null then
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
  end if;
end $$;

grant all on table public.profiles to anon;
grant all on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

grant all on table public.games to anon;
grant all on table public.games to authenticated;
grant all on table public.games to service_role;

grant all on sequence public.games_id_seq to anon;
grant all on sequence public.games_id_seq to authenticated;
grant all on sequence public.games_id_seq to service_role;

grant select on table public.bookings to anon;
grant select on table public.bookings to authenticated;
grant all on table public.bookings to service_role;

grant all on sequence public.bookings_id_seq to service_role;

alter table public.player_booking_cancellations enable row level security;

revoke all on public.player_booking_cancellations from public;
revoke all on public.player_booking_cancellations from anon;
revoke all on public.player_booking_cancellations from authenticated;
grant all on public.player_booking_cancellations to service_role;
grant usage, select on sequence public.player_booking_cancellations_id_seq to service_role;

create or replace function public.set_email_deliveries_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_email_deliveries_updated_at
on public.email_deliveries;

create trigger set_email_deliveries_updated_at
before update on public.email_deliveries
for each row
execute function public.set_email_deliveries_updated_at();

create or replace function public.claim_email_delivery(
  p_delivery_key text,
  p_email_type text,
  p_recipient_key text,
  p_booking_id bigint default null,
  p_game_id bigint default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  delivery_id bigint,
  should_send boolean,
  status text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_delivery public.email_deliveries%rowtype;
begin
  if nullif(trim(p_delivery_key), '') is null then
    raise exception 'delivery_key_required';
  end if;

  if nullif(trim(p_email_type), '') is null then
    raise exception 'email_type_required';
  end if;

  if nullif(trim(p_recipient_key), '') is null then
    raise exception 'recipient_key_required';
  end if;

  insert into public.email_deliveries (
    delivery_key,
    email_type,
    recipient_key,
    booking_id,
    game_id,
    status,
    attempts,
    claimed_at,
    metadata
  )
  values (
    trim(p_delivery_key),
    trim(p_email_type),
    trim(p_recipient_key),
    p_booking_id,
    p_game_id,
    'sending',
    1,
    now(),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (delivery_key) do nothing
  returning * into v_delivery;

  if v_delivery.id is not null then
    return query select v_delivery.id, true, v_delivery.status, v_delivery.attempts;
    return;
  end if;

  select *
  into v_delivery
  from public.email_deliveries
  where email_deliveries.delivery_key = trim(p_delivery_key)
  for update;

  if v_delivery.status = 'sent' then
    return query select v_delivery.id, false, v_delivery.status, v_delivery.attempts;
    return;
  end if;

  if v_delivery.status = 'sending'
    and v_delivery.claimed_at is not null
    and v_delivery.claimed_at > now() - interval '10 minutes'
  then
    return query select v_delivery.id, false, v_delivery.status, v_delivery.attempts;
    return;
  end if;

  update public.email_deliveries as delivery
  set
    status = 'sending',
    attempts = delivery.attempts + 1,
    claimed_at = now(),
    sanitized_error_message = null,
    metadata = coalesce(delivery.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where delivery.id = v_delivery.id
  returning delivery.* into v_delivery;

  return query select v_delivery.id, true, v_delivery.status, v_delivery.attempts;
end;
$$;

create or replace function public.mark_email_delivery_sent(
  p_delivery_id bigint,
  p_provider_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_deliveries
  set
    status = 'sent',
    sent_at = now(),
    provider_message_id = nullif(trim(p_provider_message_id), ''),
    sanitized_error_message = null
  where id = p_delivery_id
    and status = 'sending';
end;
$$;

create or replace function public.mark_email_delivery_failed(
  p_delivery_id bigint,
  p_sanitized_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_deliveries
  set
    status = 'failed',
    sanitized_error_message = left(coalesce(nullif(trim(p_sanitized_error_message), ''), 'email_send_failed'), 240)
  where id = p_delivery_id
    and status = 'sending';
end;
$$;

alter table public.email_deliveries enable row level security;

revoke all on table public.email_deliveries from public;
revoke all on table public.email_deliveries from anon;
revoke all on table public.email_deliveries from authenticated;
grant select, insert, update, delete on table public.email_deliveries to service_role;
grant usage, select on sequence public.email_deliveries_id_seq to service_role;

revoke all on function public.claim_email_delivery(text, text, text, bigint, bigint, jsonb) from public;
revoke all on function public.claim_email_delivery(text, text, text, bigint, bigint, jsonb) from anon;
revoke all on function public.claim_email_delivery(text, text, text, bigint, bigint, jsonb) from authenticated;
grant execute on function public.claim_email_delivery(text, text, text, bigint, bigint, jsonb) to service_role;

revoke all on function public.mark_email_delivery_sent(bigint, text) from public;
revoke all on function public.mark_email_delivery_sent(bigint, text) from anon;
revoke all on function public.mark_email_delivery_sent(bigint, text) from authenticated;
grant execute on function public.mark_email_delivery_sent(bigint, text) to service_role;

revoke all on function public.mark_email_delivery_failed(bigint, text) from public;
revoke all on function public.mark_email_delivery_failed(bigint, text) from anon;
revoke all on function public.mark_email_delivery_failed(bigint, text) from authenticated;
grant execute on function public.mark_email_delivery_failed(bigint, text) to service_role;
