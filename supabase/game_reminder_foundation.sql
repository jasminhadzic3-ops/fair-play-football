-- Game reminder scheduler foundation.
-- Run manually in Supabase before deploying app code that writes games.starts_at.
-- This does not backfill existing games and does not send reminder emails.

alter table public.games
add column if not exists starts_at timestamptz;

comment on column public.games.starts_at is
'Canonical timezone-aware kickoff timestamp for scheduling and reminder logic.';

comment on column public.games.time is
'Legacy display compatibility field during the starts_at transition; do not use for reminder scheduling.';

create index if not exists games_starts_at_active_idx
on public.games(starts_at)
where starts_at is not null
  and status = 'active';

create table if not exists public.game_reminder_deliveries (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  sanitized_error_code text,
  sanitized_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_reminder_deliveries_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  constraint game_reminder_deliveries_attempts_check
    check (attempts >= 0),
  constraint game_reminder_deliveries_sent_at_check
    check (
      (status = 'sent' and sent_at is not null)
      or (status <> 'sent')
    )
);

comment on column public.game_reminder_deliveries.sanitized_error_code is
'Sanitized diagnostic code only; never store raw provider payloads, names, emails, tokens, or personal data.';

comment on column public.game_reminder_deliveries.sanitized_error_message is
'Sanitized diagnostic message only; never store raw provider payloads, names, emails, tokens, or personal data.';

create unique index if not exists game_reminder_deliveries_one_per_game_user_uidx
on public.game_reminder_deliveries(game_id, user_id);

create index if not exists game_reminder_deliveries_due_idx
on public.game_reminder_deliveries(status, next_attempt_at)
where status in ('pending', 'failed');

create index if not exists game_reminder_deliveries_game_id_idx
on public.game_reminder_deliveries(game_id);

create index if not exists game_reminder_deliveries_user_id_idx
on public.game_reminder_deliveries(user_id);

create index if not exists game_reminder_deliveries_booking_id_idx
on public.game_reminder_deliveries(booking_id);

create or replace function public.set_game_reminder_deliveries_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_game_reminder_deliveries_updated_at
on public.game_reminder_deliveries;

create trigger set_game_reminder_deliveries_updated_at
before update on public.game_reminder_deliveries
for each row
execute function public.set_game_reminder_deliveries_updated_at();

alter table public.game_reminder_deliveries enable row level security;

revoke all on table public.game_reminder_deliveries from anon;
revoke all on table public.game_reminder_deliveries from authenticated;
grant select, insert, update, delete on table public.game_reminder_deliveries to service_role;
grant usage, select on sequence public.game_reminder_deliveries_id_seq to service_role;
