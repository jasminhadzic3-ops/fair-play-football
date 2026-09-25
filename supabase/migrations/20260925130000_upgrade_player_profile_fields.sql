-- Premium player-profile fields. All new fields are optional so existing
-- profiles remain valid and unchanged.

alter table public.profiles
  add column if not exists secondary_position text,
  add column if not exists preferred_foot text,
  add column if not exists accelerate_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_secondary_position_check'
  ) then
    alter table public.profiles
      add constraint profiles_secondary_position_check
      check (
        secondary_position is null or secondary_position in
          ('Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Winger', 'Flexible')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_preferred_foot_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_foot_check
      check (preferred_foot is null or preferred_foot in ('Left', 'Right', 'Both'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_accelerate_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_accelerate_type_check
      check (
        accelerate_type is null or accelerate_type in (
          'Explosive',
          'Mostly Explosive',
          'Controlled Explosive',
          'Controlled',
          'Controlled Lengthy',
          'Mostly Lengthy',
          'Lengthy'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_secondary_position_distinct_check'
  ) then
    alter table public.profiles
      add constraint profiles_secondary_position_distinct_check
      check (secondary_position is null or secondary_position is distinct from favourite_position);
  end if;
end;
$$;
