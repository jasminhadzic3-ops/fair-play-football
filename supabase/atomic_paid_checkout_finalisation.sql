-- Atomic SumUp paid checkout finalisation.
-- Run this after supabase/booking_payments.sql and supabase/atomic_booking_capacity.sql.
-- This keeps paid booking creation and booking_payments finalisation in one
-- database transaction. The app must call this only after server-side SumUp
-- verification has confirmed the checkout is paid.

do $$
declare
  v_constraint_name text;
begin
  select conname
  into v_constraint_name
  from pg_constraint
  where conrelid = 'public.booking_payments'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%payment_status%'
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.booking_payments drop constraint %I',
      v_constraint_name
    );
  end if;
end $$;

alter table public.booking_payments
add constraint booking_payments_payment_status_check
check (payment_status in ('pending', 'paid', 'paid_no_space', 'duplicate_paid', 'failed', 'expired'));

do $$
begin
  if exists (
    select 1
    from public.booking_payments
    where payment_status = 'paid'
      and booking_id is not null
    group by booking_id
    having count(*) > 1
  ) then
    raise exception 'Cannot install paid checkout duplicate protection: existing paid booking_payments rows reference the same booking. Reconcile duplicates before applying this SQL.';
  end if;

  if exists (
    select 1
    from public.booking_payments
    where payment_status = 'pending'
    group by user_id, game_id, lower(btrim(player_name))
    having count(*) > 1
  ) then
    raise exception 'Cannot install active checkout duplicate protection: existing pending booking_payments rows share the same user, game, and player name. Reconcile duplicates before applying this SQL.';
  end if;
end $$;

create unique index if not exists booking_payments_one_paid_per_booking_uidx
on public.booking_payments(booking_id)
where payment_status = 'paid'
  and booking_id is not null;

create unique index if not exists booking_payments_one_pending_identity_uidx
on public.booking_payments(user_id, game_id, lower(btrim(player_name)))
where payment_status = 'pending';

drop function if exists public.finalize_paid_sumup_checkout(
  text,
  uuid,
  bigint,
  text,
  jsonb,
  text,
  text
);

create or replace function public.finalize_paid_sumup_checkout(
  p_checkout_id text,
  p_expected_user_id uuid,
  p_expected_game_id bigint,
  p_expected_player_name text,
  p_raw_checkout jsonb default null,
  p_transaction_code text default null,
  p_sumup_transaction_id text default null
)
returns table (
  success boolean,
  payment_status text,
  booking_id bigint,
  reason text,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_count integer;
  v_booking_id bigint;
  v_existing_paid_payment_id bigint;
  v_game_status text;
  v_max_players integer;
  v_payment public.booking_payments%rowtype;
  v_player_name text;
  v_reason text;
  v_sumup_transaction_id text;
  v_transaction_code text;
  v_wallet_booking_transaction_id bigint;
begin
  v_player_name := nullif(trim(p_expected_player_name), '');
  v_transaction_code := nullif(trim(p_transaction_code), '');
  v_sumup_transaction_id := nullif(trim(p_sumup_transaction_id), '');

  if nullif(trim(p_checkout_id), '') is null then
    return query select false, null::text, null::bigint, 'invalid_checkout_id'::text, false;
    return;
  end if;

  if p_expected_user_id is null or p_expected_game_id is null or v_player_name is null then
    return query select false, null::text, null::bigint, 'invalid_expected_payment'::text, false;
    return;
  end if;

  select *
  into v_payment
  from public.booking_payments
  where checkout_id = p_checkout_id
  for update;

  if v_payment.id is null then
    return query select false, null::text, null::bigint, 'payment_not_found'::text, false;
    return;
  end if;

  if v_payment.user_id <> p_expected_user_id
    or v_payment.game_id <> p_expected_game_id
    or v_payment.player_name <> v_player_name
  then
    return query select false, v_payment.payment_status, v_payment.booking_id, 'payment_identity_mismatch'::text, false;
    return;
  end if;

  if v_payment.payment_status = 'paid'
    and v_payment.booking_id is not null
  then
    update public.booking_payments
    set
      raw_checkout = coalesce(p_raw_checkout, raw_checkout),
      transaction_code = coalesce(v_transaction_code, transaction_code),
      sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
      updated_at = now()
    where id = v_payment.id;

    return query select true, 'paid'::text, v_payment.booking_id, null::text, true;
    return;
  end if;

  if v_payment.payment_status = 'duplicate_paid' then
    update public.booking_payments
    set
      raw_checkout = coalesce(p_raw_checkout, raw_checkout),
      transaction_code = coalesce(v_transaction_code, transaction_code),
      sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
      updated_at = now()
    where id = v_payment.id;

    return query select true, 'duplicate_paid'::text, null::bigint, 'already_duplicate_payment_detected'::text, true;
    return;
  end if;

  if v_payment.payment_status = 'paid_no_space' then
    update public.booking_payments
    set
      raw_checkout = coalesce(p_raw_checkout, raw_checkout),
      transaction_code = coalesce(v_transaction_code, transaction_code),
      sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
      updated_at = now()
    where id = v_payment.id;

    return query select true, 'paid_no_space'::text, null::bigint, 'already_paid_no_space'::text, true;
    return;
  end if;

  if v_payment.payment_status not in ('pending', 'failed', 'expired', 'paid') then
    return query select false, v_payment.payment_status, v_payment.booking_id, 'invalid_payment_status'::text, false;
    return;
  end if;

  select games.max_players, games.status
  into v_max_players, v_game_status
  from public.games
  where games.id = v_payment.game_id
  for update;

  if v_max_players is null then
    return query select false, v_payment.payment_status, v_payment.booking_id, 'game_not_found'::text, false;
    return;
  end if;

  select bookings.id
  into v_booking_id
  from public.bookings
  where bookings.game_id = v_payment.game_id
    and bookings.user_id = v_payment.user_id
    and bookings.player_name = v_payment.player_name
  order by bookings.id asc
  limit 1;

  if v_booking_id is null then
    if v_game_status = 'cancelled' then
      v_reason := 'game_cancelled';
    else
      select count(*)
      into v_booking_count
      from public.bookings
      where bookings.game_id = v_payment.game_id;

      if v_booking_count >= v_max_players then
        v_reason := 'game_full';
      end if;
    end if;

    if v_reason is not null then
      update public.booking_payments
      set
        booking_id = null,
        payment_status = 'paid_no_space',
        raw_checkout = coalesce(p_raw_checkout, raw_checkout),
        transaction_code = coalesce(v_transaction_code, transaction_code),
        sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
        updated_at = now()
      where id = v_payment.id;

      return query select true, 'paid_no_space'::text, null::bigint, v_reason, false;
      return;
    end if;

    insert into public.bookings (game_id, user_id, player_name)
    values (v_payment.game_id, v_payment.user_id, v_payment.player_name)
    returning id into v_booking_id;
  end if;

  select booking_payments.id
  into v_existing_paid_payment_id
  from public.booking_payments
  where booking_payments.booking_id = v_booking_id
    and booking_payments.payment_status = 'paid'
    and booking_payments.id <> v_payment.id
  order by booking_payments.id asc
  limit 1;

  if v_existing_paid_payment_id is not null then
    update public.booking_payments
    set
      booking_id = null,
      payment_status = 'duplicate_paid',
      raw_checkout = coalesce(p_raw_checkout, raw_checkout),
      transaction_code = coalesce(v_transaction_code, transaction_code),
      sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
      updated_at = now()
    where id = v_payment.id;

    return query select true, 'duplicate_paid'::text, null::bigint, 'duplicate_payment_detected'::text, false;
    return;
  end if;

  if to_regclass('public.wallet_transactions') is not null then
    select wallet_transactions.id
    into v_wallet_booking_transaction_id
    from public.wallet_transactions
    where wallet_transactions.booking_id = v_booking_id
      and wallet_transactions.transaction_type = 'wallet_booking_payment'
      and wallet_transactions.status = 'completed'
    order by wallet_transactions.id asc
    limit 1;
  end if;

  if v_wallet_booking_transaction_id is not null then
    update public.booking_payments
    set
      booking_id = null,
      payment_status = 'duplicate_paid',
      raw_checkout = coalesce(p_raw_checkout, raw_checkout),
      transaction_code = coalesce(v_transaction_code, transaction_code),
      sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
      updated_at = now()
    where id = v_payment.id;

    return query select true, 'duplicate_paid'::text, null::bigint, 'mixed_wallet_payment_detected'::text, false;
    return;
  end if;

  update public.booking_payments
  set
    booking_id = v_booking_id,
    payment_status = 'paid',
    raw_checkout = coalesce(p_raw_checkout, raw_checkout),
    transaction_code = coalesce(v_transaction_code, transaction_code),
    sumup_transaction_id = coalesce(v_sumup_transaction_id, sumup_transaction_id),
    updated_at = now()
  where id = v_payment.id;

  return query select true, 'paid'::text, v_booking_id, null::text, false;
end;
$$;

revoke all on function public.finalize_paid_sumup_checkout(
  text,
  uuid,
  bigint,
  text,
  jsonb,
  text,
  text
) from public;
revoke all on function public.finalize_paid_sumup_checkout(
  text,
  uuid,
  bigint,
  text,
  jsonb,
  text,
  text
) from anon;
revoke all on function public.finalize_paid_sumup_checkout(
  text,
  uuid,
  bigint,
  text,
  jsonb,
  text,
  text
) from authenticated;
grant execute on function public.finalize_paid_sumup_checkout(
  text,
  uuid,
  bigint,
  text,
  jsonb,
  text,
  text
) to service_role;
