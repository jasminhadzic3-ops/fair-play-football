-- In-app waiting-list notifications.
-- Run this in the Supabase SQL editor before enabling Waiting List Phase 2A.

create table if not exists public.waiting_list_notifications (
  id bigint generated always as identity primary key,
  waiting_list_id bigint not null references public.waiting_list(id) on delete cascade,
  game_id bigint not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  status text not null default 'unread'
    check (status in ('unread', 'read', 'dismissed')),
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

create index if not exists waiting_list_notifications_user_status_created_idx
on public.waiting_list_notifications(user_id, status, created_at desc);

create index if not exists waiting_list_notifications_game_created_idx
on public.waiting_list_notifications(game_id, created_at desc);

create index if not exists waiting_list_notifications_waiting_list_idx
on public.waiting_list_notifications(waiting_list_id);

create unique index if not exists waiting_list_notifications_unread_dedupe_idx
on public.waiting_list_notifications(waiting_list_id, game_id)
where status = 'unread';

alter table public.waiting_list_notifications enable row level security;

revoke insert, update, delete on public.waiting_list_notifications from anon, authenticated;
grant select on public.waiting_list_notifications to authenticated;
grant update (status, read_at) on public.waiting_list_notifications to authenticated;

drop policy if exists "Waiting list notifications are readable by owner" on public.waiting_list_notifications;
drop policy if exists "Waiting list notifications are editable by owner" on public.waiting_list_notifications;

create policy "Waiting list notifications are readable by owner"
on public.waiting_list_notifications
for select
to authenticated
using (auth.uid() = user_id);

create policy "Waiting list notifications are editable by owner"
on public.waiting_list_notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- No insert policy is created. Trusted server-side routes use the service role
-- to notify waiting-list players when an admin opens a space.
