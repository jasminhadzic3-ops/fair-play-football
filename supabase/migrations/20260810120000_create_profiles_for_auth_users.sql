-- Keep public.profiles synchronized with newly created Supabase Auth users.
-- Existing application profile helpers remain responsible for completing and
-- updating optional player details after authentication.

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    username
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public;
revoke all on function public.create_profile_for_auth_user() from anon;
revoke all on function public.create_profile_for_auth_user() from authenticated;

drop trigger if exists create_profile_after_auth_user_insert on auth.users;

create trigger create_profile_after_auth_user_insert
after insert on auth.users
for each row
execute function public.create_profile_for_auth_user();

-- One-time, non-destructive backfill for Auth users without a profile. The
-- conflict clause guarantees that no existing public.profiles row is changed.
insert into public.profiles (
  id,
  email,
  username
)
select
  auth_user.id,
  auth_user.email,
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'username'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'Player'
  )
from auth.users as auth_user
left join public.profiles as profile
  on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;
