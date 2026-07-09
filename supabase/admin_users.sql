-- Admin allowlist for trusted server-side admin routes.
-- Run this in the Supabase SQL editor before enabling admin game mutations.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists admin_users_created_at_idx
on public.admin_users(created_at);

alter table public.admin_users enable row level security;

drop policy if exists "Admins can read their own allowlist row" on public.admin_users;

create policy "Admins can read their own allowlist row"
on public.admin_users
for select
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on table public.admin_users to service_role;

-- Client-side inserts/updates/deletes are intentionally not allowed.
-- Add or remove admins from the Supabase SQL editor or a trusted server-only
-- maintenance process.
