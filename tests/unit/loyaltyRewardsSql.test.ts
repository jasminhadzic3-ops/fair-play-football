import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(repoRoot, "supabase/migrations/20260922130000_add_loyalty_rewards_foundation.sql"),
    "utf8"
  ).toLowerCase();
}

describe("loyalty rewards foundation migration", () => {
  it("creates the approved loyalty tables with launch and completion configuration", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.loyalty_config");
    expect(sql).toContain("create table if not exists public.loyalty_booking_contributions");
    expect(sql).toContain("create table if not exists public.loyalty_reward_cycles");
    expect(sql).toContain("create table if not exists public.loyalty_progress_adjustments");
    expect(sql).toContain("create table if not exists public.loyalty_booking_ineligibility");
    expect(sql).toContain("booking_id bigint primary key");
    expect(sql).toContain("returned_value_transaction_id bigint unique references public.wallet_transactions(id)");
    expect(sql).toContain("completion_delay interval not null default interval '24 hours'");
    expect(sql).toContain("launch_at timestamptz not null default clock_timestamp()");
    expect(sql).not.toContain("rewards_game_settlements");
    expect(sql).not.toContain("loyalty_reward_bookings");
    expect(sql).not.toContain("loyalty_qualifications");
  });

  it("keeps adjustment units explicitly consumable and mutually exclusive", () => {
    const sql = readMigration();

    expect(sql).toContain("games_delta smallint not null check (games_delta in (-1, 1))");
    expect(sql).toContain("consumed_by_reward_cycle_id bigint references public.loyalty_reward_cycles(id)");
    expect(sql).toContain("reversed_by_adjustment_id bigint references public.loyalty_progress_adjustments(id)");
    expect(sql).toContain("offset_adjustment_id bigint references public.loyalty_progress_adjustments(id)");
    expect(sql).toContain("offset_contribution_id bigint references public.loyalty_booking_contributions(booking_id)");
    expect(sql).toContain("reversal_of_contribution_id bigint references public.loyalty_booking_contributions(booking_id)");
    expect(sql).toContain("loyalty_booking_contributions_not_both_consumed_or_offset");
    expect(sql).toContain("loyalty_contributions_offset_adjustment_uidx");
    expect(sql).toContain("loyalty_adjustments_reversal_contribution_uidx");
    expect(sql).toContain("loyalty_progress_adjustments_positive_state_check");
    expect(sql).toContain("num_nonnulls(consumed_by_reward_cycle_id, reversed_by_adjustment_id) <= 1");
    expect(sql).toContain("loyalty_progress_adjustments_negative_offset_check");
    expect(sql).toContain("num_nonnulls(offset_adjustment_id, offset_contribution_id) <= 1");
  });

  it("requires retained direct paid Fair Play bookings after the launch and delay", () => {
    const sql = readMigration();

    expect(sql).toContain("booking.booking_source = 'fair_play'");
    expect(sql).toContain("booking.created_at >= v_config.launch_at");
    expect(sql).toContain("game.status = 'active'");
    expect(sql).toContain("game.starts_at <= clock_timestamp() - v_config.completion_delay");
    expect(sql).toContain("payment.payment_status = 'paid'");
    expect(sql).toContain("payment.amount > 0");
    expect(sql).toContain("for update of booking");
    expect(sql).not.toContain("booking_attendance");
    expect(sql).toContain("transaction_type in ('game_cancelled_credit', 'player_cancelled_credit', 'refund_completed')");
    expect(sql).toContain("not exists (");
  });

  it("keeps wallet, cancelled, credited, and refunded bookings out of qualification", () => {
    const sql = readMigration();

    expect(sql).toContain("wallet_payment.transaction_type = 'wallet_booking_payment'");
    expect(sql).toContain("wallet_payment.status = 'completed'");
    expect(sql).toContain("wallet_payment.amount < 0");
    expect(sql).toContain("player_booking_cancellations");
    expect(sql).toContain("game.status = 'active'");
    expect(sql).toContain("game_cancelled_credit");
    expect(sql).toContain("player_cancelled_credit");
    expect(sql).toContain("refund_completed");
    expect(sql).toContain("public.loyalty_booking_ineligibility as ineligible");
    expect(sql).toContain("ineligible.booking_id = booking.id");
  });

  it("records returned-value tombstones before attempting revocation", () => {
    const sql = readMigration();

    const lockIndex = sql.indexOf("perform 1\n    from public.bookings as booking\n    where booking.id = new.booking_id\n    for update;");
    const guardIndex = sql.indexOf("insert into public.loyalty_booking_ineligibility");
    const revokeIndex = sql.indexOf("perform public.revoke_loyalty_contribution(new.booking_id, 'booking value returned')");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(guardIndex);
    expect(lockIndex).toBeLessThan(revokeIndex);
    expect(sql).toContain("insert into public.loyalty_booking_ineligibility");
    expect(sql).toContain("on conflict (booking_id) do nothing");
    expect(sql).toContain("perform public.revoke_loyalty_contribution(new.booking_id, 'booking value returned')");
    expect(sql).toContain("returned_value_transaction_id");
  });

  it("keeps pre-qualification returns from creating a negative adjustment while preserving post-qualification reversal idempotency", () => {
    const sql = readMigration();

    expect(sql).toContain("if v_contribution.booking_id is null then");
    expect(sql).toContain("return false;");
    expect(sql).toContain("source = 'system_reversal'");
    expect(sql).toContain("loyalty:system-reversal:contribution:");
    expect(sql).toContain("on conflict (idempotency_key) do nothing");
  });

  it("revalidates returned-value state after locking and before contribution insertion", () => {
    const sql = readMigration();
    const loopIndex = sql.indexOf("v_bookings_checked := v_bookings_checked + 1;");
    const revalidationIndex = sql.indexOf("select exists (\n      select 1\n      from public.loyalty_booking_ineligibility as ineligible", loopIndex);
    const contributionIndex = sql.indexOf("insert into public.loyalty_booking_contributions (", revalidationIndex);
    const lockIndex = sql.indexOf("for update of booking");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(revalidationIndex).toBeGreaterThan(loopIndex);
    expect(revalidationIndex).toBeGreaterThan(lockIndex);
    expect(revalidationIndex).toBeLessThan(contributionIndex);
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("loyalty_booking_ineligibility");
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("'game_cancelled_credit'");
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("'player_cancelled_credit'");
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("'refund_completed'");
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("if v_returned_value_found then");
    expect(sql.slice(revalidationIndex, contributionIndex)).toContain("continue;");
  });

  it("uses the existing wallet credit primitive and deterministic reward idempotency", () => {
    const sql = readMigration();

    expect(sql).toContain("public.create_wallet_credit_once(");
    expect(sql).toContain("p_transaction_type => 'promotion_bonus'");
    expect(sql).toContain("p_amount => 5.00");
    expect(sql).toContain("loyalty:reward:user:");
    expect(sql).toContain("on conflict (idempotency_key) do nothing");
    expect(sql).toContain("v_selected_units <> 5");
  });

  it("creates one idempotent system reversal without a wallet debit", () => {
    const sql = readMigration();

    expect(sql).toContain("source = 'system_reversal'");
    expect(sql).toContain("loyalty:system-reversal:contribution:");
    expect(sql).toContain("-1,\n      'system_reversal'");
    expect(sql).toContain("on conflict (idempotency_key) do nothing");
    expect(sql).not.toContain("create_wallet_debit_if_balance");
    expect(sql).toContain("apply_pending_loyalty_negative_adjustments");
    expect(sql).toContain("set offset_adjustment_id = v_positive_adjustment_id");
  });

  it("attaches revocation only to authoritative cancellation and returned-value events", () => {
    const sql = readMigration();

    expect(sql).toContain("public.player_booking_cancellations");
    expect(sql).toContain("new.status = 'released'");
    expect(sql).toContain("after update of status on public.games");
    expect(sql).toContain("new.status = 'cancelled'");
    expect(sql).toContain("after insert or update of transaction_type, status, booking_id on public.wallet_transactions");
    expect(sql).toContain("'game_cancelled_credit', 'player_cancelled_credit', 'refund_completed'");
    expect(sql).not.toContain("'refund_requested'");
  });

  it("keeps all loyalty tables and mutation functions inaccessible to normal clients", () => {
    const sql = readMigration();

    for (const table of [
      "loyalty_config",
      "loyalty_booking_contributions",
      "loyalty_reward_cycles",
      "loyalty_progress_adjustments",
      "loyalty_booking_ineligibility",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role`);
    }

    expect(sql).toContain("grant execute on function public.reconcile_loyalty_rewards(integer) to service_role");
    expect(sql).toContain("revoke all on function public.apply_pending_loyalty_negative_adjustments(uuid) from service_role");
    expect(sql).toContain("revoke all on function public.revoke_loyalty_contribution(bigint, text) from service_role");
  });
});
