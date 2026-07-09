-- Fair Play Football Row Level Security policies
-- Run this in the Supabase SQL editor or as a database migration.

-- Profiles: each profile row is owned by auth.users.id.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
drop policy if exists "Profiles are insertable by owner" on public.profiles;
drop policy if exists "Profiles are editable by owner" on public.profiles;

create policy "Profiles are readable by owner"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Profiles are insertable by owner"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "Profiles are editable by owner"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Bookings: store the authenticated owner on every booking.
alter table public.bookings
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.bookings
alter column user_id set default auth.uid();

alter table public.bookings enable row level security;

drop policy if exists "Bookings are publicly readable" on public.bookings;
drop policy if exists "Bookings are insertable by owner" on public.bookings;
drop policy if exists "Bookings are deletable by owner" on public.bookings;
drop policy if exists "Allow public deletes" on public.bookings;
drop policy if exists "Allow public inserts" on public.bookings;
drop policy if exists "Allow public read" on public.bookings;

create policy "Bookings are publicly readable"
on public.bookings
for select
to anon, authenticated
using (true);

create policy "Bookings are insertable by owner"
on public.bookings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Bookings are deletable by owner"
on public.bookings
for delete
to authenticated
using (auth.uid() = user_id);

-- No bookings update policy is created. Without a matching policy,
-- client-side updates are denied by RLS.

-- Games: public read-only from client apps.
alter table public.games enable row level security;

drop policy if exists "Games are publicly readable" on public.games;
drop policy if exists "Allow public inserts" on public.games;
drop policy if exists "Allow public read access" on public.games;
drop policy if exists "Allow public updates" on public.games;

create policy "Games are publicly readable"
on public.games
for select
to anon, authenticated
using (true);

-- No games insert/update/delete policies are created. Without matching policies,
-- client-side writes are denied by RLS. Use the Supabase service role or a
-- trusted server-side admin route for authorized game management.
