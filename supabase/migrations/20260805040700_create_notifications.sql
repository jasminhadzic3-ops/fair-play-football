-- Premium in-app notification centre foundation.
-- Apply through the Supabase migration system before deploying app code that writes
-- public.notifications.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null
    check (
      type in (
        'new_game_available',
        'booking_confirmed',
        'booking_reminder',
        'game_half_full',
        'waiting_list_spot_available',
        'game_cancelled',
        'wallet_credit_added',
        'refund_processed'
      )
    ),
  category text not null
    check (
      category in (
        'games',
        'bookings',
        'wallet',
        'refunds',
        'waiting_list'
      )
    ),
  title text not null,
  body text not null,
  icon text not null,
  action_url text,
  action_label text,
  game_id bigint references public.games(id) on delete set null,
  booking_id bigint references public.bookings(id) on delete set null,
  wallet_transaction_id bigint references public.wallet_transactions(id) on delete set null,
  refund_request_id bigint references public.wallet_transactions(id) on delete set null,
  waiting_list_id bigint references public.waiting_list(id) on delete set null,
  channel text not null default 'in_app'
    check (channel in ('in_app')),
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notifications is
'Canonical in-app notification centre for player-facing product events. Email delivery remains tracked separately.';

comment on column public.notifications.dedupe_key is
'Optional idempotency boundary for server-created notifications. Use stable product-event keys, not personal data.';

comment on column public.notifications.metadata is
'Sanitized operational metadata only. Do not store provider payloads, emails, tokens, or personal data.';

create unique index if not exists notifications_dedupe_key_uidx
on public.notifications(dedupe_key)
where dedupe_key is not null;

create index if not exists notifications_user_visible_created_idx
on public.notifications(user_id, created_at desc)
where archived_at is null;

create index if not exists notifications_user_unread_created_idx
on public.notifications(user_id, created_at desc)
where read_at is null
  and archived_at is null;

create index if not exists notifications_user_category_created_idx
on public.notifications(user_id, category, created_at desc)
where archived_at is null;

create index if not exists notifications_game_id_idx
on public.notifications(game_id)
where game_id is not null;

create or replace function public.set_notifications_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notifications_updated_at
on public.notifications;

create trigger set_notifications_updated_at
before update on public.notifications
for each row
execute function public.set_notifications_updated_at();

alter table public.notifications enable row level security;

revoke all on public.notifications from public;
revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at, archived_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
grant usage, select on sequence public.notifications_id_seq to service_role;

drop policy if exists "Notifications are readable by owner" on public.notifications;
drop policy if exists "Notifications are editable by owner" on public.notifications;

create policy "Notifications are readable by owner"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

create policy "Notifications are editable by owner"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
