-- Free Games Stage 1: first-class game pricing and server-only free booking.
-- Existing games are deliberately preserved as paid. This migration refuses to
-- install a paid/free invariant over malformed legacy prices rather than
-- silently reclassifying historical games.

alter table public.games
  add column if not exists pricing_mode text;

update public.games
set pricing_mode = 'paid'
where pricing_mode is null;

do $$
begin
  if exists (
    select 1
    from public.games
    where pricing_mode not in ('paid', 'free')
       or (pricing_mode = 'paid' and (price is null or price <= 0))
       or (pricing_mode = 'free' and price is distinct from 0)
  ) then
    raise exception
      'Cannot install Free Games pricing invariants: every existing game must be a paid game with price > 0.';
  end if;
end;
$$;

alter table public.games
  alter column pricing_mode set default 'paid',
  alter column pricing_mode set not null;

alter table public.games
  drop constraint if exists games_pricing_mode_check,
  drop constraint if exists games_pricing_mode_price_check;

alter table public.games
  add constraint games_pricing_mode_check
    check (pricing_mode in ('paid', 'free')),
  add constraint games_pricing_mode_price_check
    check (
      (pricing_mode = 'paid' and price > 0)
      or (pricing_mode = 'free' and price = 0)
    );

comment on column public.games.pricing_mode is
  'Server-authoritative pricing mode. Free games have price = 0 and never create payment or wallet records.';

-- A free booking is auditable as a normal booking cancellation, but it has no
-- refund because there was no financial source to return.
alter table public.player_booking_cancellations
  drop constraint if exists player_booking_cancellations_payment_method_check,
  drop constraint if exists player_booking_cancellations_refund_policy_check;

alter table public.player_booking_cancellations
  add constraint player_booking_cancellations_payment_method_check
    check (payment_method in ('sumup', 'wallet', 'free', 'legacy')),
  add constraint player_booking_cancellations_refund_policy_check
    check (refund_policy in ('eligible_24h', 'ineligible_within_24h', 'not_applicable', 'support_required'));

create or replace function public.create_free_booking_if_space(
  p_user_id uuid,
  p_game_id bigint,
  p_player_name text
)
returns table (
  success boolean,
  booking_id bigint,
  created boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id bigint;
  v_booking_count integer;
  v_game public.games%rowtype;
  v_player_name text := nullif(btrim(p_player_name), '');
begin
  if p_user_id is null then
    return query select false, null::bigint, false, 'invalid_user'::text;
    return;
  end if;

  if p_game_id is null or p_game_id <= 0 then
    return query select false, null::bigint, false, 'invalid_game'::text;
    return;
  end if;

  if v_player_name is null then
    return query select false, null::bigint, false, 'invalid_player_name'::text;
    return;
  end if;

  select * into v_game
  from public.games as game
  where game.id = p_game_id
  for update;

  if v_game.id is null then
    return query select false, null::bigint, false, 'game_not_found'::text;
    return;
  end if;

  if v_game.pricing_mode <> 'free' or v_game.price is distinct from 0 then
    return query select false, null::bigint, false, 'game_not_free'::text;
    return;
  end if;

  if v_game.status = 'cancelled' then
    return query select false, null::bigint, false, 'game_cancelled'::text;
    return;
  end if;

  if v_game.archived_at is not null then
    return query select false, null::bigint, false, 'game_archived'::text;
    return;
  end if;

  if v_game.status <> 'active' or v_game.starts_at is null then
    return query select false, null::bigint, false, 'game_not_bookable'::text;
    return;
  end if;

  if v_game.max_players is null or v_game.max_players <= 0 then
    return query select false, null::bigint, false, 'game_not_bookable'::text;
    return;
  end if;

  if v_game.starts_at <= clock_timestamp() then
    return query select false, null::bigint, false, 'game_completed'::text;
    return;
  end if;

  select booking.id into v_booking_id
  from public.bookings as booking
  where booking.game_id = p_game_id
    and booking.user_id = p_user_id
  order by booking.id
  limit 1;

  if v_booking_id is not null then
    return query select true, v_booking_id, false, null::text;
    return;
  end if;

  select count(*) into v_booking_count
  from public.bookings as booking
  where booking.game_id = p_game_id;

  if v_booking_count >= v_game.max_players then
    return query select false, null::bigint, false, 'game_full'::text;
    return;
  end if;

  insert into public.bookings (game_id, user_id, player_name, booking_source)
  values (p_game_id, p_user_id, v_player_name, 'fair_play')
  returning id into v_booking_id;

  return query select true, v_booking_id, true, null::text;
end;
$$;

revoke all on function public.create_free_booking_if_space(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_free_booking_if_space(uuid, bigint, text)
  to service_role;

create or replace function public.cancel_free_booking(
  p_booking_id bigint,
  p_user_id uuid
)
returns table (
  success boolean,
  booking_id bigint,
  game_id bigint,
  released boolean,
  refund_eligible boolean,
  payment_method text,
  refund_policy text,
  source_credit_transaction_id bigint,
  refund_request_id bigint,
  wallet_restoration_transaction_id bigint,
  amount numeric(10, 2),
  currency text,
  reason text,
  was_full_before_release boolean,
  space_available_after_release boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_cancellation public.player_booking_cancellations%rowtype;
  v_game public.games%rowtype;
  v_booking_count_before integer;
  v_booking_count_after integer;
  v_has_financial_history boolean;
  v_was_full boolean;
  v_space_available boolean;
begin
  if p_booking_id is null or p_booking_id <= 0 or p_user_id is null then
    return query select false, p_booking_id, null::bigint, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10,2), null::text, 'invalid_booking'::text, false, false;
    return;
  end if;

  select * into v_cancellation
  from public.player_booking_cancellations as cancellation
  where cancellation.booking_id = p_booking_id and cancellation.user_id = p_user_id
  for update;

  if v_cancellation.id is not null then
    return query select true, v_cancellation.booking_id, v_cancellation.game_id,
      v_cancellation.status = 'released', false, v_cancellation.payment_method,
      v_cancellation.refund_policy, null::bigint, null::bigint, null::bigint,
      v_cancellation.amount, v_cancellation.currency, v_cancellation.reason,
      v_cancellation.was_full_before_release, v_cancellation.space_available_after_release;
    return;
  end if;

  select * into v_booking from public.bookings as booking
  where booking.id = p_booking_id for update;

  if v_booking.id is null or v_booking.user_id is distinct from p_user_id then
    return query select false, p_booking_id, null::bigint, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10,2), null::text, 'booking_not_found'::text, false, false;
    return;
  end if;

  select * into v_game from public.games as game
  where game.id = v_booking.game_id for update;

  if v_game.id is null then
    return query select false, p_booking_id, v_booking.game_id, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10,2), null::text, 'game_not_found'::text, false, false;
    return;
  end if;

  if v_game.pricing_mode <> 'free' or v_game.price is distinct from 0 then
    return query select false, p_booking_id, v_booking.game_id, false, false, null::text, null::text, null::bigint, null::bigint, null::bigint, null::numeric(10,2), null::text, 'not_free_booking'::text, false, false;
    return;
  end if;

  select exists (select 1 from public.booking_payments as payment where payment.booking_id = v_booking.id)
      or exists (select 1 from public.wallet_transactions as transaction where transaction.booking_id = v_booking.id)
  into v_has_financial_history;

  if v_has_financial_history then
    return query select false, p_booking_id, v_booking.game_id, false, false, 'free'::text, 'not_applicable'::text, null::bigint, null::bigint, null::bigint, 0::numeric(10,2), 'GBP'::text, 'free_booking_has_financial_history'::text, false, false;
    return;
  end if;

  select count(*) into v_booking_count_before from public.bookings as booking where booking.game_id = v_booking.game_id;
  v_was_full := v_booking_count_before >= v_game.max_players;

  insert into public.player_booking_cancellations (
    booking_id, game_id, user_id, payment_method, refund_policy, status, reason,
    amount, currency, was_full_before_release, metadata
  ) values (
    v_booking.id, v_booking.game_id, p_user_id, 'free', 'not_applicable', 'recorded',
    'free_booking_cancelled', 0.00, 'GBP', v_was_full,
    jsonb_build_object('cancelled_by_user_id', p_user_id, 'pricing_mode', 'free')
  ) returning * into v_cancellation;

  delete from public.bookings as booking
  where booking.id = v_booking.id and booking.user_id = p_user_id;

  if not found then
    raise exception 'Free booking release failed.';
  end if;

  select count(*) into v_booking_count_after from public.bookings as booking where booking.game_id = v_booking.game_id;
  v_space_available := v_was_full and v_booking_count_after < v_game.max_players;

  update public.player_booking_cancellations as cancellation
  set status = 'released', space_available_after_release = v_space_available,
      metadata = cancellation.metadata || jsonb_build_object('released_at', clock_timestamp())
  where cancellation.id = v_cancellation.id
  returning * into v_cancellation;

  return query select true, v_cancellation.booking_id, v_cancellation.game_id, true,
    false, 'free'::text, 'not_applicable'::text, null::bigint, null::bigint,
    null::bigint, 0::numeric(10,2), 'GBP'::text, v_cancellation.reason,
    v_cancellation.was_full_before_release, v_cancellation.space_available_after_release;
end;
$$;

revoke all on function public.cancel_free_booking(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_free_booking(bigint, uuid) to service_role;

-- Keep the authoritative candidate functions explicit about the paid-game
-- boundary. The guarded replacement avoids silently installing against an
-- unexpected historical implementation.
do $$
declare
  v_definition text;
  v_expected text := 'and game.status = ''active''';
begin
  select pg_get_functiondef(proc.oid) into v_definition
  from pg_proc as proc
  where proc.oid = 'public.reconcile_loyalty_rewards(integer)'::regprocedure;

  if position('game.pricing_mode = ''paid''' in v_definition) = 0 then
    if position(v_expected in v_definition) = 0 then
      raise exception 'Cannot add Free Games Loyalty exclusion: expected predicate not found.';
    end if;
    execute replace(v_definition, v_expected, v_expected || E'\n      and game.pricing_mode = ''paid''');
  end if;

  select pg_get_functiondef(proc.oid) into v_definition
  from pg_proc as proc
  where proc.oid = 'public.find_referral_reward_candidate(uuid,timestamptz,timestamptz,interval,boolean,bigint,bigint,boolean)'::regprocedure;

  if position('game.pricing_mode = ''paid''' in v_definition) = 0 then
    if position(v_expected in v_definition) = 0 then
      raise exception 'Cannot add Free Games Referral exclusion: expected predicate not found.';
    end if;
    execute replace(v_definition, v_expected, v_expected || E'\n      and game.pricing_mode = ''paid''');
  end if;
end;
$$;
