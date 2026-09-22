import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(repoRoot, "supabase/migrations/20260922140000_add_my_loyalty_progress_rpc.sql"),
    "utf8"
  ).toLowerCase();
}

describe("my loyalty progress RPC migration", () => {
  it("creates the narrow read-only player progress contract", () => {
    const sql = readMigration();

    expect(sql).toContain("create or replace function public.get_my_loyalty_progress()");
    expect(sql).toContain("current_progress integer");
    expect(sql).toContain("target integer");
    expect(sql).toContain("remaining integer");
    expect(sql).toContain("total_rewards_earned integer");
    expect(sql).toContain("return query select");
    expect(sql).toContain("v_effective_progress,");
    expect(sql).toContain("    5,");
  });

  it("uses the authenticated caller as the only identity and rejects anonymous access", () => {
    const sql = readMigration();

    expect(sql).toContain("v_user_id uuid := auth.uid();");
    expect(sql).toContain("if v_user_id is null then");
    expect(sql).toContain("raise exception 'authentication required' using errcode = '42501'");
    expect(sql).not.toMatch(/p_user_id|p_player_id|p_profile_id/);
  });

  it("counts only current available contribution units", () => {
    const sql = readMigration();

    expect(sql).toContain("from public.loyalty_booking_contributions as contribution");
    expect(sql).toContain("contribution.user_id = v_user_id");
    expect(sql).toContain("contribution.revoked_at is null");
    expect(sql).toContain("contribution.consumed_by_reward_cycle_id is null");
    expect(sql).toContain("contribution.offset_by_adjustment_id is null");
  });

  it("counts only available positive adjustments and excludes their consumed, reversed, and offset states", () => {
    const sql = readMigration();

    const positiveStart = sql.indexOf("into v_positive_adjustment_units");
    const pendingNegativeStart = sql.indexOf("into v_pending_negative_units");
    const positiveQuery = sql.slice(positiveStart, pendingNegativeStart);

    expect(positiveQuery).toContain("adjustment.games_delta = 1");
    expect(positiveQuery).toContain("adjustment.consumed_by_reward_cycle_id is null");
    expect(positiveQuery).toContain("adjustment.reversed_by_adjustment_id is null");
    expect(positiveQuery).toContain("adjustment.offset_adjustment_id is null");
  });

  it("represents unresolved negative debt, including system reversals, without mutating it", () => {
    const sql = readMigration();

    const pendingNegativeStart = sql.indexOf("into v_pending_negative_units");
    const rewardCountStart = sql.indexOf("into v_total_rewards_earned");
    const pendingNegativeQuery = sql.slice(pendingNegativeStart, rewardCountStart);

    expect(pendingNegativeQuery).toContain("adjustment.games_delta = -1");
    expect(pendingNegativeQuery).toContain("adjustment.offset_contribution_id is null");
    expect(pendingNegativeQuery).toContain("adjustment.reversed_by_adjustment_id is null");
    expect(pendingNegativeQuery).toContain("adjustment.offset_adjustment_id is null");
    expect(sql).toContain("v_contribution_units + v_positive_adjustment_units - v_pending_negative_units");
    expect(sql).not.toContain("source = 'admin'");
    expect(sql).not.toContain("source = 'system_reversal'");
  });

  it("does not recount consumed cycles and derives reward history from authoritative cycles", () => {
    const sql = readMigration();

    expect(sql).toContain("from public.loyalty_reward_cycles as reward_cycle");
    expect(sql).toContain("reward_cycle.user_id = v_user_id");
    expect(sql).toContain("into v_total_rewards_earned");
    expect(sql).not.toContain("% 5");
    expect(sql).not.toContain("mod(");
  });

  it("is an authenticated, read-only SECURITY DEFINER function without direct loyalty table grants", () => {
    const sql = readMigration();

    expect(sql).toContain("stable");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function public.get_my_loyalty_progress() from public, anon, service_role");
    expect(sql).toContain("grant execute on function public.get_my_loyalty_progress() to authenticated");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)\s+on\s+public\.loyalty_/);
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|from)?\s*public\.loyalty_/);
    expect(sql).not.toContain("reconcile_loyalty_rewards");
    expect(sql).not.toContain("booking_attendance");
    expect(sql).not.toContain("public.bookings");
    expect(sql).not.toContain("public.booking_payments");
  });
});
