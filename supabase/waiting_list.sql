-- Waiting list entries for full games.
-- Run this in the Supabase SQL editor before enabling the waiting-list UI.

create table if not exists public.waiting_list (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'removed')),
  created_at timestamptz not null default now()
);

create unique index if not exists waiting_list_game_user_waiting_idx
on public.waiting_list(game_id, user_id)
where status = 'waiting';

create index if not exists waiting_list_game_id_idx
on public.waiting_list(game_id);

create index if not exists waiting_list_user_id_idx
on public.waiting_list(user_id);

alter table public.waiting_list enable row level security;

grant select, insert, delete on public.waiting_list to authenticated;
grant usage, select on sequence public.waiting_list_id_seq to authenticated;
grant select, insert, update, delete on public.waiting_list to service_role;
grant usage, select on sequence public.waiting_list_id_seq to service_role;

drop policy if exists "Waiting list rows are readable by owner" on public.waiting_list;
drop policy if exists "Waiting list rows are insertable by owner" on public.waiting_list;
drop policy if exists "Waiting list rows are deletable by owner" on public.waiting_list;

create policy "Waiting list rows are readable by owner"
on public.waiting_list
for select
to authenticated
using (auth.uid() = user_id);

create policy "Waiting list rows are insertable by owner"
on public.waiting_list
for insert
to authenticated
with check (
  auth.uid() = user_id
  and status = 'waiting'
  and exists (
    select 1
    from public.games
    where games.id = waiting_list.game_id
      and games.status = 'active'
      and games.archived_at is null
      and games.starts_at is not null
      and games.starts_at > now()
      and (
        select count(*)
        from public.bookings
        where bookings.game_id = waiting_list.game_id
      ) >= games.max_players
  )
);

create policy "Waiting list rows are deletable by owner"
on public.waiting_list
for delete
to authenticated
using (auth.uid() = user_id);
