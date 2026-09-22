-- Phase 1 rewards foundation: booking origin and admin-controlled attendance.
-- Existing rows remain legacy and are never backfilled into an eligible source.

create table if not exists public.booking_source_config (
  id boolean primary key default true check (id),
  launch_at timestamptz not null default clock_timestamp()
);

insert into public.booking_source_config (id, launch_at)
values (true, clock_timestamp())
on conflict (id) do nothing;

revoke all on public.booking_source_config from public, anon, authenticated, service_role;

alter table public.bookings
  add column if not exists booking_source text;

update public.bookings
set booking_source = 'legacy'
where booking_source is null;

alter table public.bookings
  alter column booking_source set default 'legacy',
  alter column booking_source set not null;

alter table public.bookings
  drop constraint if exists bookings_booking_source_check;

alter table public.bookings
  add constraint bookings_booking_source_check
  check (booking_source in ('fair_play', 'admin_manual', 'guest', 'third_party', 'legacy'));

create index if not exists bookings_booking_source_idx
  on public.bookings(booking_source);

create table if not exists public.booking_attendance (
  booking_id bigint primary key references public.bookings(id) on delete cascade,
  game_id bigint not null references public.games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  status text check (status in ('attended', 'no_show')),
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz,
  updated_at timestamptz not null default now(),
  correction_note text,
  created_at timestamptz not null default now()
);

create index if not exists booking_attendance_game_id_idx
  on public.booking_attendance(game_id);

create table if not exists public.booking_attendance_history (
  id bigint generated always as identity primary key,
  booking_id bigint not null,
  game_id bigint not null,
  user_id uuid,
  previous_status text check (previous_status is null or previous_status in ('attended', 'no_show')),
  new_status text not null check (new_status in ('attended', 'no_show')),
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  correction_reason text
);

create index if not exists booking_attendance_history_booking_id_idx
  on public.booking_attendance_history(booking_id, changed_at);

create index if not exists booking_attendance_history_game_id_idx
  on public.booking_attendance_history(game_id, changed_at);

alter table public.booking_attendance enable row level security;
alter table public.booking_attendance_history enable row level security;

revoke all on public.booking_attendance from public, anon, authenticated;
revoke all on public.booking_attendance_history from public, anon, authenticated;
revoke all on public.booking_attendance from service_role;
revoke all on public.booking_attendance_history from service_role;
grant select on public.booking_attendance to service_role;

-- The source is derived from trusted server-side records. Client-provided source
-- values are never accepted. The timestamp guard keeps pre-launch records legacy.
create or replace function public.assign_fair_play_booking_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set booking_source = 'fair_play'
  where id = new.booking_id
    and booking_source = 'legacy'
    and created_at >= (select launch_at from public.booking_source_config where id = true);
  return new;
end;
$$;

create or replace function public.assign_admin_booking_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set booking_source = case when new.booking_source = 'guest' then 'guest' else 'admin_manual' end
  where id = new.booking_id
    and booking_source = 'legacy'
    and created_at >= (select launch_at from public.booking_source_config where id = true);
  return new;
end;
$$;

drop trigger if exists booking_payments_assign_source on public.booking_payments;
create trigger booking_payments_assign_source
after insert or update of payment_status, booking_id on public.booking_payments
for each row
when (new.payment_status = 'paid' and new.booking_id is not null)
execute function public.assign_fair_play_booking_source();

drop trigger if exists wallet_transactions_assign_source on public.wallet_transactions;
create trigger wallet_transactions_assign_source
after insert or update of transaction_type, status, booking_id on public.wallet_transactions
for each row
when (new.transaction_type = 'wallet_booking_payment' and new.status = 'completed' and new.booking_id is not null)
execute function public.assign_fair_play_booking_source();

do $$
begin
  if to_regclass('public.admin_booking_details') is not null then
    execute 'drop trigger if exists admin_booking_details_assign_source on public.admin_booking_details';
    execute 'create trigger admin_booking_details_assign_source
      after insert on public.admin_booking_details
      for each row
      execute function public.assign_admin_booking_source()';
  else
    raise warning 'Phase 1 booking source: public.admin_booking_details is absent; admin source trigger was not installed.';
  end if;
end;
$$;

revoke all on function public.assign_fair_play_booking_source() from public, anon, authenticated;
revoke all on function public.assign_admin_booking_source() from public, anon, authenticated;
grant execute on function public.assign_fair_play_booking_source() to service_role;
grant execute on function public.assign_admin_booking_source() to service_role;

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
    from public.admin_users
    where user_id = p_marked_by
  ) then
    raise exception 'Unauthorized admin';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null or v_booking.game_id is null then
    raise exception 'Booking not found';
  end if;

  select * into v_current
  from public.booking_attendance
  where booking_id = p_booking_id
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
  on conflict (booking_id) do update set
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
