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

create or replace function public.cancel_game_with_wallet_credits(
  p_game_id bigint,
  p_admin_user_id uuid,
  p_cancellation_reason text default null
)
returns table (
  success boolean,
  game_id bigint,
  already_cancelled boolean,
  sumup_credited_count integer,
  wallet_credited_count integer,
  total_credited_count integer,
  waiting_list_removed_count integer,
  affected_user_ids uuid[],
  email_should_send boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected_user_ids uuid[];
  v_existing_credit public.wallet_transactions%rowtype;
  v_game public.games%rowtype;
  v_key text;
  v_reason text;
  v_waiting_list_removed_count integer;
  v_wallet_credited_count integer := 0;
  v_sumup_credited_count integer := 0;
  v_credit record;
begin
  v_reason := nullif(trim(p_cancellation_reason), '');

  if p_game_id is null or p_game_id <= 0 then
    return query select false, p_game_id, false, 0, 0, 0, 0, array[]::uuid[], false, 'invalid_game'::text;
    return;
  end if;

  if p_admin_user_id is null then
    return query select false, p_game_id, false, 0, 0, 0, 0, array[]::uuid[], false, 'invalid_admin_user'::text;
    return;
  end if;

  select *
  into v_game
  from public.games
  where id = p_game_id
  for update;

  if v_game.id is null then
    return query select false, p_game_id, false, 0, 0, 0, 0, array[]::uuid[], false, 'game_not_found'::text;
    return;
  end if;

  select coalesce(array_agg(distinct bookings.user_id) filter (where bookings.user_id is not null), array[]::uuid[])
  into v_affected_user_ids
  from public.bookings
  where bookings.game_id = p_game_id;

  if v_game.status = 'cancelled' then
    return query select true, p_game_id, true, 0, 0, 0, 0, coalesce(v_affected_user_ids, array[]::uuid[]), false, null::text;
    return;
  end if;

  perform 1
  from public.bookings
  where bookings.game_id = p_game_id
  for update;

  if exists (
    select 1
    from public.bookings
    join public.booking_payments
      on booking_payments.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and booking_payments.payment_status = 'paid'
      and booking_payments.user_id is distinct from bookings.user_id
  ) then
    raise exception 'Cannot cancel game: a SumUp payment has mismatched booking user details.';
  end if;

  if exists (
    select 1
    from public.bookings
    join public.wallet_transactions
      on wallet_transactions.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and wallet_transactions.transaction_type = 'wallet_booking_payment'
      and wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
      and wallet_transactions.user_id is distinct from bookings.user_id
  ) then
    raise exception 'Cannot cancel game: a wallet payment has mismatched booking user details.';
  end if;

  if exists (
    select 1
    from public.bookings
    join public.booking_payments
      on booking_payments.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and booking_payments.payment_status = 'paid'
      and booking_payments.amount > 0
    group by bookings.id
    having count(*) > 1
  ) then
    raise exception 'Cannot cancel game: a booking has multiple paid SumUp payment records.';
  end if;

  if exists (
    select 1
    from public.bookings
    join public.wallet_transactions
      on wallet_transactions.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and wallet_transactions.transaction_type = 'wallet_booking_payment'
      and wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
    group by bookings.id
    having count(*) > 1
  ) then
    raise exception 'Cannot cancel game: a booking has multiple wallet booking payment records.';
  end if;

  if exists (
    select 1
    from public.bookings
    where bookings.game_id = p_game_id
      and exists (
        select 1
        from public.booking_payments
        where booking_payments.booking_id = bookings.id
          and booking_payments.payment_status = 'paid'
          and booking_payments.amount > 0
      )
      and exists (
        select 1
        from public.wallet_transactions
        where wallet_transactions.booking_id = bookings.id
          and wallet_transactions.transaction_type = 'wallet_booking_payment'
          and wallet_transactions.status = 'completed'
          and wallet_transactions.amount < 0
      )
  ) then
    raise exception 'Cannot cancel game: a booking has both SumUp and wallet payment records.';
  end if;

  for v_credit in
    select
      bookings.id as booking_id,
      bookings.user_id,
      booking_payments.id as payment_id,
      booking_payments.amount::numeric(10, 2) as amount,
      coalesce(nullif(trim(booking_payments.currency), ''), 'GBP') as currency
    from public.bookings
    join public.booking_payments
      on booking_payments.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and booking_payments.payment_status = 'paid'
      and booking_payments.amount > 0
    order by bookings.id
  loop
    v_key := 'game_cancelled_credit:game:' || p_game_id::text || ':payment:' || v_credit.payment_id::text;

    select *
    into v_existing_credit
    from public.wallet_transactions
    where idempotency_key = v_key
    for update;

    if v_existing_credit.id is not null then
      if v_existing_credit.user_id is distinct from v_credit.user_id
        or v_existing_credit.amount <> v_credit.amount
        or v_existing_credit.currency <> v_credit.currency
        or v_existing_credit.transaction_type <> 'game_cancelled_credit'
        or v_existing_credit.status <> 'completed'
        or v_existing_credit.game_id is distinct from p_game_id
        or v_existing_credit.booking_id is distinct from v_credit.booking_id
        or v_existing_credit.payment_id is distinct from v_credit.payment_id
      then
        raise exception 'Cannot cancel game: existing cancellation credit conflicts with SumUp payment %. ', v_credit.payment_id;
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
        v_credit.user_id,
        v_credit.amount,
        v_key,
        v_credit.currency,
        'game_cancelled_credit',
        'completed',
        p_game_id,
        v_credit.booking_id,
        v_credit.payment_id,
        'Credit for cancelled game: ' || coalesce(v_game.title, 'Football match'),
        v_reason,
        jsonb_build_object(
          'original_payment_method', 'sumup',
          'original_payment_id', v_credit.payment_id,
          'original_game_id', p_game_id,
          'original_booking_id', v_credit.booking_id,
          'cancelled_by', p_admin_user_id
        )
      );
    end if;

    v_sumup_credited_count := v_sumup_credited_count + 1;
  end loop;

  for v_credit in
    select
      bookings.id as booking_id,
      bookings.user_id,
      wallet_transactions.id as wallet_transaction_id,
      abs(wallet_transactions.amount)::numeric(10, 2) as amount,
      coalesce(nullif(trim(wallet_transactions.currency), ''), 'GBP') as currency
    from public.bookings
    join public.wallet_transactions
      on wallet_transactions.booking_id = bookings.id
    where bookings.game_id = p_game_id
      and wallet_transactions.transaction_type = 'wallet_booking_payment'
      and wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
    order by bookings.id
  loop
    v_key := 'game_cancelled_credit:game:' || p_game_id::text || ':wallet_transaction:' || v_credit.wallet_transaction_id::text;

    select *
    into v_existing_credit
    from public.wallet_transactions
    where idempotency_key = v_key
    for update;

    if v_existing_credit.id is not null then
      if v_existing_credit.user_id is distinct from v_credit.user_id
        or v_existing_credit.amount <> v_credit.amount
        or v_existing_credit.currency <> v_credit.currency
        or v_existing_credit.transaction_type <> 'game_cancelled_credit'
        or v_existing_credit.status <> 'completed'
        or v_existing_credit.game_id is distinct from p_game_id
        or v_existing_credit.booking_id is distinct from v_credit.booking_id
      then
        raise exception 'Cannot cancel game: existing cancellation credit conflicts with wallet transaction %. ', v_credit.wallet_transaction_id;
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
        description,
        admin_note,
        metadata
      )
      values (
        v_credit.user_id,
        v_credit.amount,
        v_key,
        v_credit.currency,
        'game_cancelled_credit',
        'completed',
        p_game_id,
        v_credit.booking_id,
        'Credit for cancelled game: ' || coalesce(v_game.title, 'Football match'),
        v_reason,
        jsonb_build_object(
          'original_payment_method', 'wallet',
          'original_wallet_transaction_id', v_credit.wallet_transaction_id,
          'original_game_id', p_game_id,
          'original_booking_id', v_credit.booking_id,
          'cancelled_by', p_admin_user_id
        )
      );
    end if;

    v_wallet_credited_count := v_wallet_credited_count + 1;
  end loop;

  update public.waiting_list
  set status = 'removed'
  where waiting_list.game_id = p_game_id
    and waiting_list.status = 'waiting';

  get diagnostics v_waiting_list_removed_count = row_count;

  update public.games
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = p_admin_user_id,
    cancellation_reason = v_reason
  where games.id = p_game_id;

  return query select
    true,
    p_game_id,
    false,
    v_sumup_credited_count,
    v_wallet_credited_count,
    v_sumup_credited_count + v_wallet_credited_count,
    v_waiting_list_removed_count,
    coalesce(v_affected_user_ids, array[]::uuid[]),
    true,
    null::text;
end;
$$;

revoke all on function public.cancel_game_with_wallet_credits(
  bigint,
  uuid,
  text
) from public;
revoke all on function public.cancel_game_with_wallet_credits(
  bigint,
  uuid,
  text
) from anon;
revoke all on function public.cancel_game_with_wallet_credits(
  bigint,
  uuid,
  text
) from authenticated;
grant execute on function public.cancel_game_with_wallet_credits(
  bigint,
  uuid,
  text
) to service_role;
