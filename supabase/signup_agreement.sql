-- Signup agreement foundation.
-- Run manually in Supabase before deploying app code that writes profile agreement fields.

alter table public.profiles
add column if not exists terms_accepted_at timestamptz;

alter table public.profiles
add column if not exists terms_version text;

comment on column public.profiles.terms_accepted_at is
'Timestamp when the user accepted the Fair Play Football Terms of Service and Privacy Policy during signup. Existing users may be null.';

comment on column public.profiles.terms_version is
'Terms/Privacy version accepted by the user during signup. Existing users may be null.';
