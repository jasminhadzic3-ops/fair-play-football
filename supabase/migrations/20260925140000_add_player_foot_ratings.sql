-- Add optional five-star foot ability ratings without changing the legacy
-- preferred_foot column or attempting to infer ratings from it.

alter table public.profiles
  add column if not exists left_foot_rating integer,
  add column if not exists right_foot_rating integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_left_foot_rating_check'
  ) then
    alter table public.profiles
      add constraint profiles_left_foot_rating_check
      check (left_foot_rating is null or left_foot_rating between 1 and 5);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_right_foot_rating_check'
  ) then
    alter table public.profiles
      add constraint profiles_right_foot_rating_check
      check (right_foot_rating is null or right_foot_rating between 1 and 5);
  end if;
end;
$$;
