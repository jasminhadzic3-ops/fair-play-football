-- Fair Play Football wallet ledger foundation.
-- Run this in the Supabase SQL editor before enabling wallet features.
-- This creates the ledger only. It does not connect wallet credit to bookings,
-- refunds, cancellations, or any frontend display.

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(10, 2) not null check (amount <> 0),
  currency text not null default 'GBP',
  transaction_type text not null
    check (
      transaction_type in (
        'game_cancelled_credit',
        'wallet_booking_payment',
        'refund_requested',
        'refund_completed',
        'manual_adjustment',
        'admin_credit',
        'promotion_bonus'
      )
    ),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'cancelled')),
  game_id bigint references public.games(id) on delete set null,
  booking_id bigint references public.bookings(id) on delete set null,
  payment_id bigint references public.booking_payments(id) on delete set null,
  description text,
  admin_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_created_at_idx
on public.wallet_transactions(user_id, created_at desc);

create index if not exists wallet_transactions_user_status_currency_idx
on public.wallet_transactions(user_id, status, currency);

create index if not exists wallet_transactions_game_id_idx
on public.wallet_transactions(game_id);

create index if not exists wallet_transactions_booking_id_idx
on public.wallet_transactions(booking_id);

create index if not exists wallet_transactions_payment_id_idx
on public.wallet_transactions(payment_id);

create or replace function public.set_wallet_transactions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_wallet_transactions_updated_at
on public.wallet_transactions;

create trigger set_wallet_transactions_updated_at
before update on public.wallet_transactions
for each row
execute function public.set_wallet_transactions_updated_at();

alter table public.wallet_transactions enable row level security;

revoke all on public.wallet_transactions from anon;
revoke all on public.wallet_transactions from authenticated;

grant select on public.wallet_transactions to authenticated;
grant all on public.wallet_transactions to service_role;
grant usage, select on sequence public.wallet_transactions_id_seq to service_role;

drop policy if exists "Wallet transactions are readable by owner"
on public.wallet_transactions;

create policy "Wallet transactions are readable by owner"
on public.wallet_transactions
for select
to authenticated
using (auth.uid() = user_id);

-- Client-side inserts/updates/deletes are intentionally not allowed.
-- Trusted backend routes using the Supabase service role should manage all
-- wallet ledger writes.

create or replace function public.get_wallet_balance(
  p_user_id uuid,
  p_currency text default 'GBP'
)
returns numeric(10, 2)
language sql
stable
as $$
  select coalesce(sum(amount), 0)::numeric(10, 2)
  from public.wallet_transactions
  where user_id = p_user_id
    and status = 'completed'
    and currency = coalesce(p_currency, 'GBP');
$$;

revoke all on function public.get_wallet_balance(uuid, text) from public;
grant execute on function public.get_wallet_balance(uuid, text) to authenticated;
grant execute on function public.get_wallet_balance(uuid, text) to service_role;

create or replace function public.get_my_wallet_balance(
  p_currency text default 'GBP'
)
returns numeric(10, 2)
language sql
stable
as $$
  select public.get_wallet_balance(auth.uid(), coalesce(p_currency, 'GBP'));
$$;

revoke all on function public.get_my_wallet_balance(text) from public;
grant execute on function public.get_my_wallet_balance(text) to authenticated;
grant execute on function public.get_my_wallet_balance(text) to service_role;
