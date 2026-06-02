-- Pending SumUp Hosted Checkout payments.
-- Run this in the Supabase SQL editor before using the SumUp payment routes.

create table if not exists public.booking_payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id bigint not null references public.games(id) on delete cascade,
  player_name text not null,
  checkout_id text not null unique,
  checkout_reference text not null unique,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'expired')),
  booking_id bigint references public.bookings(id) on delete set null,
  hosted_checkout_url text,
  amount numeric(10, 2) not null,
  currency text not null default 'GBP',
  transaction_code text,
  raw_checkout jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_payments_user_id_idx
on public.booking_payments(user_id);

create index if not exists booking_payments_game_id_idx
on public.booking_payments(game_id);

alter table public.booking_payments enable row level security;

drop policy if exists "Payment records are readable by owner" on public.booking_payments;

create policy "Payment records are readable by owner"
on public.booking_payments
for select
to authenticated
using (auth.uid() = user_id);

-- Client-side inserts/updates/deletes are intentionally not allowed.
-- Trusted Next.js API routes use the Supabase service role to create and update
-- pending payment records and confirmed bookings.
