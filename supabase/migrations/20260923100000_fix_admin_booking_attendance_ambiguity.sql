-- Follow-up fix for the deployed attendance RPC. Keep the public contract and
-- behaviour unchanged; qualify table columns that collide with output names.

create or replace function public.admin_set_booking_attendance(
  p_booking_id bigint,
  p_status text,
  p_marked_by uuid,
  p_correction_reason text default null
)
returns table (
  booking_id bigint,
  game_id bigint,
  user_id uuid,
  status text,
  marked_by uuid,
  marked_at timestamptz,
  updated_at timestamptz,
  correction_note text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_current public.booking_attendance%rowtype;
  v_reason text := nullif(trim(p_correction_reason), '');
begin
  if p_booking_id is null or p_marked_by is null or p_status not in ('attended', 'no_show') then
    raise exception 'Invalid attendance input';
  end if;

  if not exists (
    select 1
    from public.admin_users as admin_user
    where admin_user.user_id = p_marked_by
  ) then
    raise exception 'Unauthorized admin';
  end if;

  select * into v_booking
  from public.bookings as booking
  where booking.id = p_booking_id
  for update;

  if v_booking.id is null or v_booking.game_id is null then
    raise exception 'Booking not found';
  end if;

  select * into v_current
  from public.booking_attendance as attendance
  where attendance.booking_id = p_booking_id
  for update;

  if v_current.booking_id is not null and v_current.status = p_status then
    return query select
      v_current.booking_id,
      v_current.game_id,
      v_current.user_id,
      v_current.status,
      v_current.marked_by,
      v_current.marked_at,
      v_current.updated_at,
      v_current.correction_note;
    return;
  end if;

  insert into public.booking_attendance_history (
    booking_id, game_id, user_id, previous_status, new_status, changed_by, correction_reason
  )
  values (
    v_booking.id, v_booking.game_id, v_booking.user_id,
    v_current.status, p_status, p_marked_by, v_reason
  );

  return query insert into public.booking_attendance (
    booking_id, game_id, user_id, status, marked_by, marked_at, updated_at, correction_note
  )
  values (
    v_booking.id, v_booking.game_id, v_booking.user_id, p_status, p_marked_by, now(), now(), v_reason
  )
  on conflict on constraint booking_attendance_pkey do update set
    game_id = excluded.game_id,
    user_id = excluded.user_id,
    status = excluded.status,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at,
    updated_at = excluded.updated_at,
    correction_note = excluded.correction_note
  returning
    booking_attendance.booking_id,
    booking_attendance.game_id,
    booking_attendance.user_id,
    booking_attendance.status,
    booking_attendance.marked_by,
    booking_attendance.marked_at,
    booking_attendance.updated_at,
    booking_attendance.correction_note;
end;
$$;

revoke all on function public.admin_set_booking_attendance(bigint, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_booking_attendance(bigint, text, uuid, text)
  to service_role;
