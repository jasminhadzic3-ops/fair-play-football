-- Read-only player-facing Fair Play Rewards progress.
-- Loyalty qualification and reward issuance remain owned by the Stage 1
-- reconciliation function; this function exposes only the caller's current state.

create or replace function public.get_my_loyalty_progress()
returns table (
  current_progress integer,
  target integer,
  remaining integer,
  total_rewards_earned integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_contribution_units integer := 0;
  v_positive_adjustment_units integer := 0;
  v_pending_negative_units integer := 0;
  v_effective_progress integer := 0;
  v_total_rewards_earned integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select count(*)::integer
  into v_contribution_units
  from public.loyalty_booking_contributions as contribution
  where contribution.user_id = v_user_id
    and contribution.revoked_at is null
    and contribution.consumed_by_reward_cycle_id is null
    and contribution.offset_by_adjustment_id is null;

  select count(*)::integer
  into v_positive_adjustment_units
  from public.loyalty_progress_adjustments as adjustment
  where adjustment.user_id = v_user_id
    and adjustment.games_delta = 1
    and adjustment.consumed_by_reward_cycle_id is null
    and adjustment.reversed_by_adjustment_id is null
    and adjustment.offset_adjustment_id is null;

  select count(*)::integer
  into v_pending_negative_units
  from public.loyalty_progress_adjustments as adjustment
  where adjustment.user_id = v_user_id
    and adjustment.games_delta = -1
    and adjustment.offset_contribution_id is null
    and adjustment.reversed_by_adjustment_id is null
    and adjustment.offset_adjustment_id is null;

  select count(*)::integer
  into v_total_rewards_earned
  from public.loyalty_reward_cycles as reward_cycle
  where reward_cycle.user_id = v_user_id;

  -- A pending negative adjustment is debt against the next available unit.
  -- Do not use modulo or cap the upper value: if reconciliation is delayed,
  -- reporting five or more units truthfully avoids disguising pending issuance.
  v_effective_progress := greatest(
    0,
    v_contribution_units + v_positive_adjustment_units - v_pending_negative_units
  );

  return query select
    v_effective_progress,
    5,
    greatest(0, 5 - v_effective_progress),
    v_total_rewards_earned;
end;
$$;

revoke all on function public.get_my_loyalty_progress() from public, anon, service_role;
grant execute on function public.get_my_loyalty_progress() to authenticated;
