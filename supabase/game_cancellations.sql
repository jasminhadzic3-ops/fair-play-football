-- Game cancellation status foundation.
-- Run this before deploying app code that reads or writes game cancellation status.

alter table public.games
add column if not exists status text not null default 'active';

alter table public.games
drop constraint if exists games_status_check;

alter table public.games
add constraint games_status_check
check (status in ('active', 'cancelled'));

alter table public.games
add column if not exists cancelled_at timestamptz;

alter table public.games
add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

alter table public.games
add column if not exists cancellation_reason text;

create index if not exists games_status_idx
on public.games(status);
