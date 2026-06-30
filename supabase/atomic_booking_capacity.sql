-- Atomic booking capacity protection for paid SumUp finalisation.
-- Run this in the Supabase SQL editor before deploying the matching app code.

do $$
declare
  payment_status_constraint_name text;
begin
  select conname
  into payment_status_constraint_name
  from pg_constraint
  where conrelid = 'public.booking_payments'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%payment_status%'
  limit 1;

  if payment_status_constraint_name is not null then
    execute format(
      'alter table public.booking_payments drop constraint %I',
      payment_status_constraint_name
    );
  end if;
end $$;

alter table public.booking_payments
add constraint booking_payments_payment_status_check
check (payment_status in ('pending', 'paid', 'paid_no_space', 'failed', 'expired'));

create or replace function public.create_booking_if_space(
  p_game_id bigint,
  p_user_id uuid,
  p_player_name text
)
returns table (
  success boolean,
  booking_id bigint,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_players integer;
  v_booking_count integer;
  v_booking_id bigint;
  v_game_status text;
  v_player_name text;
begin
  v_player_name := nullif(trim(p_player_name), '');

  if p_game_id is null or p_user_id is null or v_player_name is null then
    return query select false, null::bigint, 'invalid_input'::text;
    return;
  end if;

  select games.max_players, games.status
  into v_max_players, v_game_status
  from public.games
  where games.id = p_game_id
  for update;

  if v_max_players is null then
    return query select false, null::bigint, 'game_not_found'::text;
    return;
  end if;

  if v_game_status = 'cancelled' then
    return query select false, null::bigint, 'game_cancelled'::text;
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
    return query select true, v_booking_id, null::text;
    return;
  end if;

  select count(*)
  into v_booking_count
  from public.bookings
  where bookings.game_id = p_game_id;

  if v_booking_count >= v_max_players then
    return query select false, null::bigint, 'game_full'::text;
    return;
  end if;

  insert into public.bookings (game_id, user_id, player_name)
  values (p_game_id, p_user_id, v_player_name)
  returning id into v_booking_id;

  return query select true, v_booking_id, null::text;
end;
$$;

revoke all on function public.create_booking_if_space(bigint, uuid, text) from public;
revoke all on function public.create_booking_if_space(bigint, uuid, text) from anon;
revoke all on function public.create_booking_if_space(bigint, uuid, text) from authenticated;
grant execute on function public.create_booking_if_space(bigint, uuid, text) to service_role;
