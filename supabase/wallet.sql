-- Fair Play Football wallet ledger foundation.
-- Run this in the Supabase SQL editor before enabling wallet features.
-- This creates the ledger only. It does not connect wallet credit to bookings,
-- refunds, cancellations, or any frontend display.

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(10, 2) not null check (amount <> 0),
  idempotency_key text,
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
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  game_id bigint references public.games(id) on delete set null,
  booking_id bigint references public.bookings(id) on delete set null,
  payment_id bigint references public.booking_payments(id) on delete set null,
  description text,
  admin_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallet_transactions
add column if not exists idempotency_key text;

alter table public.wallet_transactions
drop constraint if exists wallet_transactions_status_check;

alter table public.wallet_transactions
add constraint wallet_transactions_status_check
check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled'));

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

create unique index if not exists wallet_transactions_idempotency_key_uidx
on public.wallet_transactions(idempotency_key)
where idempotency_key is not null;

drop index if exists public.wallet_refund_requests_one_pending_per_user_currency_uidx;
drop index if exists public.wallet_refund_requests_one_active_per_source_credit_uidx;

create unique index if not exists wallet_refund_requests_one_active_per_source_credit_uidx
on public.wallet_transactions((metadata->>'source_wallet_transaction_id'))
where transaction_type = 'refund_requested'
  and status in ('pending', 'processing', 'completed')
  and metadata ? 'source_wallet_transaction_id';

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
revoke all on function public.get_wallet_balance(uuid, text) from authenticated;
grant execute on function public.get_wallet_balance(uuid, text) to service_role;

create or replace function public.get_my_wallet_balance(
  p_currency text default 'GBP'
)
returns numeric(10, 2)
language sql
stable
security definer
set search_path = public
as $$
  select public.get_wallet_balance(auth.uid(), coalesce(p_currency, 'GBP'));
$$;

revoke all on function public.get_my_wallet_balance(text) from public;
grant execute on function public.get_my_wallet_balance(text) to authenticated;
grant execute on function public.get_my_wallet_balance(text) to service_role;

create or replace function public.get_wallet_balance_breakdown(
  p_user_id uuid,
  p_currency text default 'GBP'
)
returns table (
  completed_balance numeric(10, 2),
  reserved_refund_amount numeric(10, 2),
  available_balance numeric(10, 2)
)
language sql
stable
as $$
  with normalized_currency as (
    select coalesce(nullif(trim(p_currency), ''), 'GBP') as currency
  ),
  completed as (
    select coalesce(sum(wallet_transactions.amount), 0)::numeric(10, 2) as amount
    from public.wallet_transactions, normalized_currency
    where wallet_transactions.user_id = p_user_id
      and wallet_transactions.status = 'completed'
      and wallet_transactions.currency = normalized_currency.currency
  ),
  reserved as (
    select coalesce(sum(abs(wallet_transactions.amount)), 0)::numeric(10, 2) as amount
    from public.wallet_transactions, normalized_currency
    where wallet_transactions.user_id = p_user_id
      and wallet_transactions.transaction_type = 'refund_requested'
      and wallet_transactions.status in ('pending', 'processing')
      and wallet_transactions.currency = normalized_currency.currency
  )
  select
    completed.amount as completed_balance,
    reserved.amount as reserved_refund_amount,
    (completed.amount - reserved.amount)::numeric(10, 2) as available_balance
  from completed, reserved;
$$;

revoke all on function public.get_wallet_balance_breakdown(uuid, text) from public;
revoke all on function public.get_wallet_balance_breakdown(uuid, text) from authenticated;
grant execute on function public.get_wallet_balance_breakdown(uuid, text) to service_role;

create or replace function public.get_my_wallet_balance_breakdown(
  p_currency text default 'GBP'
)
returns table (
  completed_balance numeric(10, 2),
  reserved_refund_amount numeric(10, 2),
  available_balance numeric(10, 2)
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.get_wallet_balance_breakdown(auth.uid(), coalesce(p_currency, 'GBP'));
$$;

revoke all on function public.get_my_wallet_balance_breakdown(text) from public;
grant execute on function public.get_my_wallet_balance_breakdown(text) to authenticated;
grant execute on function public.get_my_wallet_balance_breakdown(text) to service_role;

create or replace function public.create_wallet_debit_if_balance(
  p_user_id uuid,
  p_amount numeric,
  p_currency text default 'GBP',
  p_transaction_type text default 'wallet_booking_payment',
  p_idempotency_key text default null,
  p_game_id bigint default null,
  p_booking_id bigint default null,
  p_payment_id bigint default null,
  p_description text default null,
  p_admin_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  transaction_id bigint,
  reason text,
  balance numeric(10, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(10, 2);
  v_completed_balance numeric(10, 2);
  v_currency text;
  v_existing_transaction public.wallet_transactions%rowtype;
  v_excluded_refund_request_id bigint;
  v_idempotency_key text;
  v_reserved_refund_amount numeric(10, 2);
  v_transaction_id bigint;
begin
  v_currency := coalesce(nullif(trim(p_currency), ''), 'GBP');
  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_excluded_refund_request_id := null;

  if p_user_id is null then
    return query select false, null::bigint, 'invalid_user'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    return query select false, null::bigint, 'invalid_amount'::text, 0::numeric(10, 2);
    return;
  end if;

  if v_idempotency_key is null then
    return query select false, null::bigint, 'missing_idempotency_key'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_transaction_type not in (
    'wallet_booking_payment',
    'refund_completed',
    'manual_adjustment'
  ) then
    return query select false, null::bigint, 'invalid_debit_transaction_type'::text, 0::numeric(10, 2);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(v_currency));

  if p_transaction_type = 'refund_completed'
    and p_metadata ? 'refund_request_id'
    and (p_metadata->>'refund_request_id') ~ '^[0-9]+$'
  then
    v_excluded_refund_request_id := (p_metadata->>'refund_request_id')::bigint;
  end if;

  select *
  into v_existing_transaction
  from public.wallet_transactions
  where idempotency_key = v_idempotency_key;

  select completed_balance, reserved_refund_amount, available_balance
  into v_completed_balance, v_reserved_refund_amount, v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  if v_excluded_refund_request_id is not null then
    select coalesce(sum(abs(wallet_transactions.amount)), 0)::numeric(10, 2)
    into v_reserved_refund_amount
    from public.wallet_transactions
    where wallet_transactions.user_id = p_user_id
      and wallet_transactions.transaction_type = 'refund_requested'
      and wallet_transactions.status in ('pending', 'processing')
      and wallet_transactions.currency = v_currency
      and wallet_transactions.id <> v_excluded_refund_request_id;

    v_balance := (v_completed_balance - v_reserved_refund_amount)::numeric(10, 2);
  end if;

  if v_existing_transaction.id is not null then
    if v_existing_transaction.user_id = p_user_id
      and v_existing_transaction.amount = -p_amount
      and v_existing_transaction.currency = v_currency
      and v_existing_transaction.transaction_type = p_transaction_type
      and v_existing_transaction.status = 'completed'
    then
      return query select true, v_existing_transaction.id, null::text, v_balance;
      return;
    end if;

    return query select false, v_existing_transaction.id, 'idempotency_key_conflict'::text, v_balance;
    return;
  end if;

  if v_balance < p_amount then
    return query select false, null::bigint, 'insufficient_balance'::text, v_balance;
    return;
  end if;

  insert into public.wallet_transactions (
    user_id,
    amount,
    idempotency_key,
    currency,
    transaction_type,
    status,
    game_id,
    booking_id,
    payment_id,
    description,
    admin_note,
    metadata
  )
  values (
    p_user_id,
    -p_amount,
    v_idempotency_key,
    v_currency,
    p_transaction_type,
    'completed',
    p_game_id,
    p_booking_id,
    p_payment_id,
    p_description,
    p_admin_note,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  select available_balance
  into v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  return query select true, v_transaction_id, null::text, v_balance;
end;
$$;

revoke all on function public.create_wallet_debit_if_balance(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from public;
revoke all on function public.create_wallet_debit_if_balance(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from anon;
revoke all on function public.create_wallet_debit_if_balance(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.create_wallet_debit_if_balance(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.create_wallet_refund_request(
  p_user_id uuid,
  p_source_wallet_transaction_id bigint,
  p_idempotency_key text default null
)
returns table (
  success boolean,
  refund_request_id bigint,
  reason text,
  already_exists boolean,
  completed_balance numeric(10, 2),
  reserved_refund_amount numeric(10, 2),
  available_balance numeric(10, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available_balance numeric(10, 2);
  v_completed_balance numeric(10, 2);
  v_currency text;
  v_existing_request public.wallet_transactions%rowtype;
  v_existing_transaction public.wallet_transactions%rowtype;
  v_idempotency_key text;
  v_refund_request_id bigint;
  v_reserved_refund_amount numeric(10, 2);
  v_source_credit public.wallet_transactions%rowtype;
  v_source_credit_amount numeric(10, 2);
begin
  if p_user_id is null then
    return query select false, null::bigint, 'invalid_user'::text, false, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  if p_source_wallet_transaction_id is null or p_source_wallet_transaction_id <= 0 then
    return query select false, null::bigint, 'invalid_source_credit'::text, false, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  select *
  into v_source_credit
  from public.wallet_transactions
  where id = p_source_wallet_transaction_id
  for update;

  if v_source_credit.id is null then
    return query select false, null::bigint, 'source_credit_not_found'::text, false, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  v_currency := coalesce(nullif(trim(v_source_credit.currency), ''), 'GBP');

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(v_currency));

  select balance_breakdown.completed_balance, balance_breakdown.reserved_refund_amount, balance_breakdown.available_balance
  into v_completed_balance, v_reserved_refund_amount, v_available_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency) as balance_breakdown;

  if v_source_credit.user_id <> p_user_id then
    return query select false, null::bigint, 'source_credit_not_owned'::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  if v_source_credit.transaction_type <> 'game_cancelled_credit'
    or v_source_credit.status <> 'completed'
    or v_source_credit.payment_id is null
    or coalesce(v_source_credit.metadata->>'original_payment_method', '') <> 'sumup'
  then
    return query select false, null::bigint, 'not_sumup_cancellation_credit'::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  v_source_credit_amount := v_source_credit.amount;

  if v_source_credit_amount is null or v_source_credit_amount <= 0 then
    return query select false, null::bigint, 'invalid_source_amount'::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  select *
  into v_existing_request
  from public.wallet_transactions
  where user_id = p_user_id
    and transaction_type = 'refund_requested'
    and status in ('pending', 'processing', 'completed')
    and metadata->>'source_wallet_transaction_id' = v_source_credit.id::text
  order by created_at asc
  limit 1;

  if v_existing_request.id is not null then
    return query select true, v_existing_request.id, null::text, true, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  if v_available_balance < v_source_credit_amount then
    return query select false, null::bigint, 'insufficient_balance'::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  v_idempotency_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'refund_requested:source_credit:' || v_source_credit.id::text
  );

  select *
  into v_existing_transaction
  from public.wallet_transactions
  where idempotency_key = v_idempotency_key;

  if v_existing_transaction.id is not null then
    if v_existing_transaction.user_id = p_user_id
      and v_existing_transaction.transaction_type = 'refund_requested'
      and v_existing_transaction.amount = -v_source_credit_amount
      and v_existing_transaction.currency = v_currency
      and v_existing_transaction.metadata->>'source_wallet_transaction_id' = v_source_credit.id::text
    then
      return query select true, v_existing_transaction.id, null::text, true, v_completed_balance, v_reserved_refund_amount, v_available_balance;
      return;
    end if;

    return query select false, v_existing_transaction.id, 'idempotency_key_conflict'::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  insert into public.wallet_transactions (
    user_id,
    amount,
    idempotency_key,
    currency,
    transaction_type,
    status,
    game_id,
    booking_id,
    payment_id,
    description,
    metadata
  )
  values (
    p_user_id,
    -v_source_credit_amount,
    v_idempotency_key,
    v_currency,
    'refund_requested',
    'pending',
    v_source_credit.game_id,
    v_source_credit.booking_id,
    v_source_credit.payment_id,
    'Refund requested',
    jsonb_build_object(
      'source_wallet_transaction_id', v_source_credit.id,
      'source_transaction_type', v_source_credit.transaction_type,
      'original_payment_method', v_source_credit.metadata->>'original_payment_method',
      'original_payment_id', v_source_credit.payment_id,
      'original_game_id', v_source_credit.game_id,
      'original_booking_id', v_source_credit.booking_id,
      'refund_mode', 'source_credit',
      'automatic_refund_eligible', true
    )
  )
  returning id into v_refund_request_id;

  select balance_breakdown.completed_balance, balance_breakdown.reserved_refund_amount, balance_breakdown.available_balance
  into v_completed_balance, v_reserved_refund_amount, v_available_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency) as balance_breakdown;

  return query select true, v_refund_request_id, null::text, false, v_completed_balance, v_reserved_refund_amount, v_available_balance;
end;
$$;

revoke all on function public.create_wallet_refund_request(
  uuid,
  bigint,
  text
) from public;
revoke all on function public.create_wallet_refund_request(
  uuid,
  bigint,
  text
) from anon;
revoke all on function public.create_wallet_refund_request(
  uuid,
  bigint,
  text
) from authenticated;
grant execute on function public.create_wallet_refund_request(
  uuid,
  bigint,
  text
) to service_role;

create or replace function public.complete_wallet_refund_request(
  p_refund_request_id bigint,
  p_admin_user_id uuid,
  p_idempotency_key text default null,
  p_description text default 'Refund completed',
  p_admin_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  refund_request_id bigint,
  refund_transaction_id bigint,
  reason text,
  completed_balance numeric(10, 2),
  reserved_refund_amount numeric(10, 2),
  available_balance numeric(10, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available_balance numeric(10, 2);
  v_amount numeric(10, 2);
  v_available_excluding_request numeric(10, 2);
  v_completed_balance numeric(10, 2);
  v_currency text;
  v_existing_transaction public.wallet_transactions%rowtype;
  v_idempotency_key text;
  v_metadata jsonb;
  v_refund_request public.wallet_transactions%rowtype;
  v_reserved_excluding_request numeric(10, 2);
  v_reserved_refund_amount numeric(10, 2);
  v_transaction_id bigint;
begin
  if p_refund_request_id is null then
    return query select false, null::bigint, null::bigint, 'invalid_refund_request'::text, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  if p_admin_user_id is null then
    return query select false, p_refund_request_id, null::bigint, 'invalid_admin_user'::text, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  select *
  into v_refund_request
  from public.wallet_transactions
  where id = p_refund_request_id
    and transaction_type = 'refund_requested'
  for update;

  if v_refund_request.id is null then
    return query select false, p_refund_request_id, null::bigint, 'refund_request_not_found'::text, 0::numeric(10, 2), 0::numeric(10, 2), 0::numeric(10, 2);
    return;
  end if;

  v_currency := coalesce(nullif(trim(v_refund_request.currency), ''), 'GBP');
  v_amount := abs(v_refund_request.amount);
  v_idempotency_key := coalesce(nullif(trim(p_idempotency_key), ''), 'refund_completed:request:' || v_refund_request.id::text);

  perform pg_advisory_xact_lock(hashtext(v_refund_request.user_id::text), hashtext(v_currency));

  select balance_breakdown.completed_balance, balance_breakdown.reserved_refund_amount, balance_breakdown.available_balance
  into v_completed_balance, v_reserved_refund_amount, v_available_balance
  from public.get_wallet_balance_breakdown(v_refund_request.user_id, v_currency) as balance_breakdown;

  if v_refund_request.status = 'completed' then
    if (v_refund_request.metadata->>'refund_completed_transaction_id') ~ '^[0-9]+$' then
      v_transaction_id := (v_refund_request.metadata->>'refund_completed_transaction_id')::bigint;
    else
      v_transaction_id := null;
    end if;

    return query select true, v_refund_request.id, v_transaction_id, null::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  if v_refund_request.status not in ('pending', 'processing') then
    return query select false, v_refund_request.id, null::bigint, 'invalid_refund_request_status'::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  if v_amount is null or v_amount <= 0 then
    return query select false, v_refund_request.id, null::bigint, 'invalid_refund_amount'::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  select coalesce(sum(abs(wallet_transactions.amount)), 0)::numeric(10, 2)
  into v_reserved_excluding_request
  from public.wallet_transactions
  where wallet_transactions.user_id = v_refund_request.user_id
    and wallet_transactions.transaction_type = 'refund_requested'
    and wallet_transactions.status in ('pending', 'processing')
    and wallet_transactions.currency = v_currency
    and wallet_transactions.id <> v_refund_request.id;

  v_available_excluding_request := (v_completed_balance - v_reserved_excluding_request)::numeric(10, 2);

  if v_available_excluding_request < v_amount then
    return query select false, v_refund_request.id, null::bigint, 'insufficient_balance'::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
    return;
  end if;

  select *
  into v_existing_transaction
  from public.wallet_transactions
  where idempotency_key = v_idempotency_key;

  if v_existing_transaction.id is not null then
    if v_existing_transaction.user_id = v_refund_request.user_id
      and v_existing_transaction.amount = -v_amount
      and v_existing_transaction.currency = v_currency
      and v_existing_transaction.transaction_type = 'refund_completed'
      and v_existing_transaction.status = 'completed'
    then
      v_transaction_id := v_existing_transaction.id;
    else
      return query select false, v_refund_request.id, v_existing_transaction.id, 'idempotency_key_conflict'::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
      return;
    end if;
  else
    insert into public.wallet_transactions (
      user_id,
      amount,
      idempotency_key,
      currency,
      transaction_type,
      status,
      game_id,
      booking_id,
      payment_id,
      description,
      admin_note,
      metadata
    )
    values (
      v_refund_request.user_id,
      -v_amount,
      v_idempotency_key,
      v_currency,
      'refund_completed',
      'completed',
      v_refund_request.game_id,
      v_refund_request.booking_id,
      v_refund_request.payment_id,
      coalesce(p_description, 'Refund completed'),
      p_admin_note,
      coalesce(p_metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'refund_request_id', v_refund_request.id,
          'processed_by', p_admin_user_id,
          'manual', true
        )
    )
    returning id into v_transaction_id;
  end if;

  v_metadata := coalesce(v_refund_request.metadata, '{}'::jsonb) ||
    coalesce(p_metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'refund_completed_transaction_id', v_transaction_id,
      'processed_by', p_admin_user_id,
      'processed_at', now()
    );

  update public.wallet_transactions
  set
    status = 'completed',
    admin_note = p_admin_note,
    metadata = v_metadata
  where id = v_refund_request.id;

  select balance_breakdown.completed_balance, balance_breakdown.reserved_refund_amount, balance_breakdown.available_balance
  into v_completed_balance, v_reserved_refund_amount, v_available_balance
  from public.get_wallet_balance_breakdown(v_refund_request.user_id, v_currency) as balance_breakdown;

  return query select true, v_refund_request.id, v_transaction_id, null::text, v_completed_balance, v_reserved_refund_amount, v_available_balance;
end;
$$;

revoke all on function public.complete_wallet_refund_request(
  bigint,
  uuid,
  text,
  text,
  text,
  jsonb
) from public;
revoke all on function public.complete_wallet_refund_request(
  bigint,
  uuid,
  text,
  text,
  text,
  jsonb
) from anon;
revoke all on function public.complete_wallet_refund_request(
  bigint,
  uuid,
  text,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.complete_wallet_refund_request(
  bigint,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.create_wallet_credit_once(
  p_user_id uuid,
  p_amount numeric,
  p_currency text default 'GBP',
  p_transaction_type text default 'game_cancelled_credit',
  p_idempotency_key text default null,
  p_game_id bigint default null,
  p_booking_id bigint default null,
  p_payment_id bigint default null,
  p_description text default null,
  p_admin_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  transaction_id bigint,
  reason text,
  balance numeric(10, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(10, 2);
  v_currency text;
  v_existing_transaction public.wallet_transactions%rowtype;
  v_idempotency_key text;
  v_transaction_id bigint;
begin
  v_currency := coalesce(nullif(trim(p_currency), ''), 'GBP');
  v_idempotency_key := nullif(trim(p_idempotency_key), '');

  if p_user_id is null then
    return query select false, null::bigint, 'invalid_user'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    return query select false, null::bigint, 'invalid_amount'::text, 0::numeric(10, 2);
    return;
  end if;

  if v_idempotency_key is null then
    return query select false, null::bigint, 'missing_idempotency_key'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_transaction_type not in (
    'game_cancelled_credit',
    'refund_requested',
    'admin_credit',
    'promotion_bonus'
  ) then
    return query select false, null::bigint, 'invalid_credit_transaction_type'::text, 0::numeric(10, 2);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(v_currency));

  select *
  into v_existing_transaction
  from public.wallet_transactions
  where idempotency_key = v_idempotency_key;

  select available_balance
  into v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  if v_existing_transaction.id is not null then
    if v_existing_transaction.user_id = p_user_id
      and v_existing_transaction.amount = p_amount
      and v_existing_transaction.currency = v_currency
      and v_existing_transaction.transaction_type = p_transaction_type
      and v_existing_transaction.status = 'completed'
    then
      return query select true, v_existing_transaction.id, null::text, v_balance;
      return;
    end if;

    return query select false, v_existing_transaction.id, 'idempotency_key_conflict'::text, v_balance;
    return;
  end if;

  insert into public.wallet_transactions (
    user_id,
    amount,
    idempotency_key,
    currency,
    transaction_type,
    status,
    game_id,
    booking_id,
    payment_id,
    description,
    admin_note,
    metadata
  )
  values (
    p_user_id,
    p_amount,
    v_idempotency_key,
    v_currency,
    p_transaction_type,
    'completed',
    p_game_id,
    p_booking_id,
    p_payment_id,
    p_description,
    p_admin_note,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  select available_balance
  into v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  return query select true, v_transaction_id, null::text, v_balance;
end;
$$;

revoke all on function public.create_wallet_credit_once(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from public;
revoke all on function public.create_wallet_credit_once(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from anon;
revoke all on function public.create_wallet_credit_once(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.create_wallet_credit_once(
  uuid,
  numeric,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.create_wallet_booking_if_balance(
  p_user_id uuid,
  p_game_id bigint,
  p_player_name text,
  p_amount numeric,
  p_currency text default 'GBP',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  booking_id bigint,
  wallet_transaction_id bigint,
  reason text,
  balance numeric(10, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(10, 2);
  v_booking_count integer;
  v_booking_id bigint;
  v_currency text;
  v_existing_transaction public.wallet_transactions%rowtype;
  v_game_status text;
  v_idempotency_key text;
  v_max_players integer;
  v_player_name text;
  v_wallet_transaction_id bigint;
begin
  v_currency := coalesce(nullif(trim(p_currency), ''), 'GBP');
  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_player_name := nullif(trim(p_player_name), '');

  if p_user_id is null then
    return query select false, null::bigint, null::bigint, 'invalid_user'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_game_id is null then
    return query select false, null::bigint, null::bigint, 'invalid_game'::text, 0::numeric(10, 2);
    return;
  end if;

  if v_player_name is null then
    return query select false, null::bigint, null::bigint, 'invalid_player_name'::text, 0::numeric(10, 2);
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    return query select false, null::bigint, null::bigint, 'invalid_amount'::text, 0::numeric(10, 2);
    return;
  end if;

  if v_idempotency_key is null then
    return query select false, null::bigint, null::bigint, 'missing_idempotency_key'::text, 0::numeric(10, 2);
    return;
  end if;

  select games.max_players, games.status
  into v_max_players, v_game_status
  from public.games
  where games.id = p_game_id
  for update;

  if v_max_players is null then
    return query select false, null::bigint, null::bigint, 'game_not_found'::text, 0::numeric(10, 2);
    return;
  end if;

  if v_game_status = 'cancelled' then
    return query select false, null::bigint, null::bigint, 'game_cancelled'::text, 0::numeric(10, 2);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(v_currency));

  select *
  into v_existing_transaction
  from public.wallet_transactions
  where idempotency_key = v_idempotency_key;

  select available_balance
  into v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  if v_existing_transaction.id is not null then
    if v_existing_transaction.user_id = p_user_id
      and v_existing_transaction.game_id = p_game_id
      and v_existing_transaction.amount = -p_amount
      and v_existing_transaction.currency = v_currency
      and v_existing_transaction.transaction_type = 'wallet_booking_payment'
      and v_existing_transaction.status = 'completed'
    then
      return query select true, v_existing_transaction.booking_id, v_existing_transaction.id, null::text, v_balance;
      return;
    end if;

    return query select false, v_existing_transaction.booking_id, v_existing_transaction.id, 'idempotency_key_conflict'::text, v_balance;
    return;
  end if;

  select bookings.id
  into v_booking_id
  from public.bookings
  where bookings.game_id = p_game_id
    and bookings.user_id = p_user_id
    and bookings.player_name = v_player_name
  limit 1;

  if v_booking_id is not null then
    return query select false, v_booking_id, null::bigint, 'existing_booking'::text, v_balance;
    return;
  end if;

  select count(*)
  into v_booking_count
  from public.bookings
  where bookings.game_id = p_game_id;

  if v_booking_count >= v_max_players then
    return query select false, null::bigint, null::bigint, 'game_full'::text, v_balance;
    return;
  end if;

  if v_balance < p_amount then
    return query select false, null::bigint, null::bigint, 'insufficient_balance'::text, v_balance;
    return;
  end if;

  insert into public.bookings (game_id, user_id, player_name)
  values (p_game_id, p_user_id, v_player_name)
  returning id into v_booking_id;

  insert into public.wallet_transactions (
    user_id,
    amount,
    idempotency_key,
    currency,
    transaction_type,
    status,
    game_id,
    booking_id,
    description,
    metadata
  )
  values (
    p_user_id,
    -p_amount,
    v_idempotency_key,
    v_currency,
    'wallet_booking_payment',
    'completed',
    p_game_id,
    v_booking_id,
    'Wallet payment for booking',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_wallet_transaction_id;

  select available_balance
  into v_balance
  from public.get_wallet_balance_breakdown(p_user_id, v_currency);

  return query select true, v_booking_id, v_wallet_transaction_id, null::text, v_balance;
end;
$$;

revoke all on function public.create_wallet_booking_if_balance(
  uuid,
  bigint,
  text,
  numeric,
  text,
  text,
  jsonb
) from public;
revoke all on function public.create_wallet_booking_if_balance(
  uuid,
  bigint,
  text,
  numeric,
  text,
  text,
  jsonb
) from anon;
revoke all on function public.create_wallet_booking_if_balance(
  uuid,
  bigint,
  text,
  numeric,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.create_wallet_booking_if_balance(
  uuid,
  bigint,
  text,
  numeric,
  text,
  text,
  jsonb
) to service_role;
