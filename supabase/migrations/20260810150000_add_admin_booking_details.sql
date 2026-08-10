create table if not exists public.admin_booking_details (
  booking_id bigint primary key references public.bookings(id) on delete cascade,
  payment_method text not null
    check (payment_method in ('website', 'cash', 'free', 'manual')),
  booking_source text not null
    check (booking_source in ('website', 'cash', 'manual', 'guest')),
  added_by text not null
    check (added_by in ('admin', 'player', 'system')),
  notes text,
  guest_phone text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_booking_details is
'Private operational metadata for bookings. Never expose this table through player-facing APIs.';

alter table public.admin_booking_details enable row level security;

revoke all on public.admin_booking_details from public, anon, authenticated;
grant all on public.admin_booking_details to service_role;

create or replace function public.add_admin_game_booking(
  p_game_id bigint,
  p_user_id uuid,
  p_player_name text,
  p_payment_method text,
  p_booking_source text,
  p_added_by text,
  p_notes text default null,
  p_guest_phone text default null,
  p_created_by uuid default null
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
  v_booking_count integer;
  v_booking_id bigint;
  v_game_status text;
  v_archived_at timestamptz;
  v_max_players integer;
  v_player_name text := nullif(trim(p_player_name), '');
begin
  if p_game_id is null
    or v_player_name is null
    or p_payment_method not in ('website', 'cash', 'free', 'manual')
    or p_booking_source not in ('website', 'cash', 'manual', 'guest')
    or p_added_by not in ('admin', 'player', 'system')
  then
    return query select false, null::bigint, 'invalid_input'::text;
    return;
  end if;

  if p_booking_source = 'guest' and p_user_id is not null then
    return query select false, null::bigint, 'invalid_guest'::text;
    return;
  end if;

  if p_booking_source <> 'guest' and p_user_id is null then
    return query select false, null::bigint, 'missing_user'::text;
    return;
  end if;

  select games.max_players, games.status, games.archived_at
  into v_max_players, v_game_status, v_archived_at
  from public.games
  where games.id = p_game_id
  for update;

  if v_max_players is null then
    return query select false, null::bigint, 'game_not_found'::text;
    return;
  end if;

  if v_game_status = 'cancelled' or v_archived_at is not null then
    return query select false, null::bigint, 'game_unavailable'::text;
    return;
  end if;

  if p_user_id is not null and exists (
    select 1
    from public.bookings
    where bookings.game_id = p_game_id
      and bookings.user_id = p_user_id
  ) then
    return query select false, null::bigint, 'already_booked'::text;
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

  insert into public.admin_booking_details (
    booking_id,
    payment_method,
    booking_source,
    added_by,
    notes,
    guest_phone,
    created_by
  )
  values (
    v_booking_id,
    p_payment_method,
    p_booking_source,
    p_added_by,
    nullif(trim(p_notes), ''),
    nullif(trim(p_guest_phone), ''),
    p_created_by
  );

  return query select true, v_booking_id, null::text;
end;
$$;

revoke all on function public.add_admin_game_booking(
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.add_admin_game_booking(
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) to service_role;

create or replace function public.update_admin_game_booking(
  p_booking_id bigint,
  p_player_name text,
  p_payment_method text,
  p_notes text default null,
  p_guest_phone text default null
)
returns table (
  success boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail public.admin_booking_details%rowtype;
  v_player_name text := nullif(trim(p_player_name), '');
begin
  select *
  into v_detail
  from public.admin_booking_details
  where admin_booking_details.booking_id = p_booking_id
  for update;

  if v_detail.booking_id is null or v_detail.added_by <> 'admin' then
    return query select false, 'not_admin_booking'::text;
    return;
  end if;

  if p_payment_method not in ('website', 'cash', 'free', 'manual') then
    return query select false, 'invalid_payment_method'::text;
    return;
  end if;

  if v_detail.booking_source = 'guest' and v_player_name is null then
    return query select false, 'invalid_player_name'::text;
    return;
  end if;

  if v_detail.booking_source = 'guest' then
    update public.bookings
    set player_name = v_player_name
    where id = p_booking_id;
  end if;

  update public.admin_booking_details
  set payment_method = p_payment_method,
      notes = nullif(trim(p_notes), ''),
      guest_phone = case
        when v_detail.booking_source = 'guest' then nullif(trim(p_guest_phone), '')
        else null
      end,
      updated_at = now()
  where booking_id = p_booking_id;

  return query select true, null::text;
end;
$$;

revoke all on function public.update_admin_game_booking(
  bigint,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.update_admin_game_booking(
  bigint,
  text,
  text,
  text,
  text
) to service_role;
