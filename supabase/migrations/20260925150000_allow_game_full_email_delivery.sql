-- Allow the durable email ledger to record the once-per-recipient Game On email.
-- This is forward-only and preserves all existing delivery rows and idempotency keys.

alter table public.email_deliveries
  drop constraint if exists email_deliveries_type_check;

alter table public.email_deliveries
  add constraint email_deliveries_type_check
  check (email_type in ('booking_confirmation', 'game_half_full', 'game_full'));
