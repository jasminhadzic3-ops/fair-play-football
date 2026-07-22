-- Atomic admin booking moves.
-- Run this manually in Supabase before deploying app code that calls move_booking_if_space.

create or replace function public.move_booking_if_space(
  p_booking_id bigint,
  p_target_game_id bigint
)
returns table (
  success boolean,
  booking_id bigint,
  source_game_id bigint,
  target_game_id bigint,
  reason text,
  source_was_full_before_move boolean,
  source_has_space_after_move boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_paid_booking_payment_count integer := 0;
  v_non_paid_booking_payment_count integer := 0;
  v_source_booking_count_after integer := 0;
  v_source_booking_count_before integer := 0;
  v_source_game public.games%rowtype;
  v_target_booking_count integer := 0;
  v_target_game public.games%rowtype;
  v_valid_wallet_booking_payment_count integer := 0;
  v_ambiguous_wallet_booking_payment_count integer := 0;
begin
  if p_booking_id is null or p_booking_id <= 0 then
    return query select false, p_booking_id, null::bigint, p_target_game_id, 'invalid_booking'::text, false, false;
    return;
  end if;

  if p_target_game_id is null or p_target_game_id <= 0 then
    return query select false, p_booking_id, null::bigint, p_target_game_id, 'invalid_target_game'::text, false, false;
    return;
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    return query select false, p_booking_id, null::bigint, p_target_game_id, 'booking_not_found'::text, false, false;
    return;
  end if;

  if v_booking.game_id is null then
    return query select false, v_booking.id, null::bigint, p_target_game_id, 'booking_missing_game'::text, false, false;
    return;
  end if;

  if v_booking.game_id = p_target_game_id then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'same_game'::text, false, false;
    return;
  end if;

  perform 1
  from public.games
  where id in (v_booking.game_id, p_target_game_id)
  order by id
  for update;

  select *
  into v_source_game
  from public.games
  where id = v_booking.game_id;

  select *
  into v_target_game
  from public.games
  where id = p_target_game_id;

  if v_target_game.id is null then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_not_found'::text, false, false;
    return;
  end if;

  if v_target_game.status = 'cancelled' then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_cancelled'::text, false, false;
    return;
  end if;

  if v_target_game.status <> 'active' then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_not_active'::text, false, false;
    return;
  end if;

  if v_target_game.starts_at is null then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_missing_starts_at'::text, false, false;
    return;
  end if;

  if v_target_game.starts_at <= now() then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_past'::text, false, false;
    return;
  end if;

  if exists (
    select 1
    from public.wallet_transactions
    where wallet_transactions.booking_id = v_booking.id
      and wallet_transactions.transaction_type = 'game_cancelled_credit'
  ) then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'booking_has_cancellation_history'::text, false, false;
    return;
  end if;

  if exists (
    select 1
    from public.wallet_transactions
    where wallet_transactions.booking_id = v_booking.id
      and wallet_transactions.transaction_type in ('refund_requested', 'refund_completed')
  ) or exists (
    select 1
    from public.sumup_refund_attempts
    join public.booking_payments
      on booking_payments.id = sumup_refund_attempts.booking_payment_id
    where booking_payments.booking_id = v_booking.id
  ) or exists (
    select 1
    from public.sumup_refund_attempts
    join public.wallet_transactions refund_requests
      on refund_requests.id = sumup_refund_attempts.refund_request_id
    where refund_requests.booking_id = v_booking.id
  ) then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'booking_has_refund_history'::text, false, false;
    return;
  end if;

  select count(*)
  into v_paid_booking_payment_count
  from public.booking_payments
  where booking_payments.booking_id = v_booking.id
    and booking_payments.payment_status = 'paid';

  select count(*)
  into v_non_paid_booking_payment_count
  from public.booking_payments
  where booking_payments.booking_id = v_booking.id
    and booking_payments.payment_status <> 'paid';

  select count(*)
  into v_valid_wallet_booking_payment_count
  from public.wallet_transactions
  where wallet_transactions.booking_id = v_booking.id
    and wallet_transactions.transaction_type = 'wallet_booking_payment'
    and wallet_transactions.status = 'completed'
    and wallet_transactions.amount < 0;

  select count(*)
  into v_ambiguous_wallet_booking_payment_count
  from public.wallet_transactions
  where wallet_transactions.booking_id = v_booking.id
    and wallet_transactions.transaction_type = 'wallet_booking_payment'
    and not (
      wallet_transactions.status = 'completed'
      and wallet_transactions.amount < 0
    );

  if v_paid_booking_payment_count > 1
    or v_non_paid_booking_payment_count > 0
    or v_valid_wallet_booking_payment_count > 1
    or v_ambiguous_wallet_booking_payment_count > 0
    or (v_paid_booking_payment_count = 1 and v_valid_wallet_booking_payment_count = 1)
  then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'booking_has_ambiguous_payment_history'::text, false, false;
    return;
  end if;

  select count(*)
  into v_source_booking_count_before
  from public.bookings
  where game_id = v_booking.game_id;

  select count(*)
  into v_target_booking_count
  from public.bookings
  where game_id = p_target_game_id;

  if v_target_booking_count >= coalesce(v_target_game.max_players, 0) then
    return query select false, v_booking.id, v_booking.game_id, p_target_game_id, 'target_game_full'::text, false, false;
    return;
  end if;

  update public.bookings
  set game_id = p_target_game_id
  where id = v_booking.id;

  update public.booking_payments
  set
    game_id = p_target_game_id,
    updated_at = now()
  where booking_id = v_booking.id
    and payment_status = 'paid';

  update public.wallet_transactions
  set
    game_id = p_target_game_id,
    metadata = coalesce(metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'moved_from_game_id', v_booking.game_id,
        'moved_to_game_id', p_target_game_id,
        'moved_at', now()
      )
  where booking_id = v_booking.id
    and transaction_type = 'wallet_booking_payment'
    and status = 'completed'
    and amount < 0;

  if v_booking.user_id is not null then
    update public.waiting_list
    set status = 'removed'
    where user_id = v_booking.user_id
      and game_id = p_target_game_id
      and status = 'waiting';
  end if;

  select count(*)
  into v_source_booking_count_after
  from public.bookings
  where game_id = v_booking.game_id;

  return query select
    true,
    v_booking.id,
    v_booking.game_id,
    p_target_game_id,
    null::text,
    v_source_game.id is not null and v_source_booking_count_before >= coalesce(v_source_game.max_players, 0),
    v_source_game.id is not null and v_source_booking_count_after < coalesce(v_source_game.max_players, 0);
end;
$$;

revoke all on function public.move_booking_if_space(bigint, bigint) from public;
revoke all on function public.move_booking_if_space(bigint, bigint) from anon;
revoke all on function public.move_booking_if_space(bigint, bigint) from authenticated;
grant execute on function public.move_booking_if_space(bigint, bigint) to service_role;
