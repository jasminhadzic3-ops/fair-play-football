-- Durable email delivery tracking for operational emails.
-- Run manually in Supabase before deploying app code that calls
-- public.claim_email_delivery.

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
  updated_at timestamptz not null default now(),
  constraint email_deliveries_type_check
    check (email_type in ('booking_confirmation', 'game_half_full')),
  constraint email_deliveries_status_check
    check (status in ('sending', 'sent', 'failed')),
  constraint email_deliveries_attempts_check
    check (attempts >= 0),
  constraint email_deliveries_sent_at_check
    check (
      (status = 'sent' and sent_at is not null)
      or (status <> 'sent')
    )
);

comment on table public.email_deliveries is
'Server-only durable delivery ledger for operational emails. The delivery_key is the duplicate-protection boundary.';

comment on column public.email_deliveries.recipient_key is
'Stable non-email recipient key such as an auth user id or hashed test recipient identifier. Do not store recipient email addresses or names.';

comment on column public.email_deliveries.sanitized_error_message is
'Sanitized diagnostic message only; never store raw provider payloads, names, emails, tokens, or personal data.';

comment on column public.email_deliveries.metadata is
'Sanitized operational metadata only. Do not store names, emails, provider payloads, tokens, or personal data.';

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
