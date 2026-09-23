import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260923110000_add_referral_reward_unlock_reconciliation.sql"
  ),
  "utf8"
).toLowerCase();

describe("referral reward unlock reconciliation migration", () => {
  it("uses the locked referral lifecycle and its own two-hour settlement point", () => {
    expect(sql).toContain("create index if not exists referral_relationships_locked_reward_idx");
    expect(sql).toContain("create table if not exists public.referral_config");
    expect(sql).toContain("completion_delay interval not null default interval '2 hours'");
    expect(sql).toContain("values (true, interval '2 hours')");
    expect(sql).toContain("alter table public.referral_config enable row level security");
    expect(sql).toContain(
      "revoke all on public.referral_config from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("relationship.email_verification_state = 'verified'");
    expect(sql).toContain("relationship.referrer_reward_state = 'credited'");
    expect(sql).toContain("referred_reward_state = 'locked'");
    expect(sql).toContain("referred_reward_locked_at is not null");
    expect(sql).toContain("from public.referral_config as config");
    expect(sql).toContain(
      "game.starts_at <= clock_timestamp() - v_referral_completion_delay"
    );
    expect(sql).not.toContain("from public.loyalty_config as config");
    expect(sql).not.toContain("v_completion_delay");
    expect(sql).not.toContain("alter table public.loyalty_config");
    expect(sql).not.toContain("insert into public.loyalty_config");
    expect(sql).toContain("game.starts_at >= v_relationship.referred_reward_locked_at");
    expect(sql).toContain("order by game.starts_at asc, booking.id asc");
  });

  it("requires retained direct paid value and excludes non-qualifying sources", () => {
    expect(sql).toContain("booking.booking_source = 'fair_play'");
    expect(sql).toContain("payment.payment_status = 'paid'");
    expect(sql).toContain("payment.amount > 0");
    expect(sql).toContain("other_payment.payment_status = 'paid'");
    expect(sql).toContain("wallet_payment.transaction_type = 'wallet_booking_payment'");
    expect(sql).toContain("wallet_payment.status = 'completed'");
    expect(sql).toContain("wallet_payment.amount < 0");
    expect(sql).toContain("from public.player_booking_cancellations as cancellation");
    expect(sql).toContain("'game_cancelled_credit'");
    expect(sql).toContain("'player_cancelled_credit'");
    expect(sql).toContain("'refund_completed'");
    expect(sql).toContain("from public.loyalty_booking_ineligibility as ineligible");
  });

  it("does not use or mutate attendance", () => {
    expect(sql).not.toContain("booking_attendance");
    expect(sql).not.toContain("booking_attendance_history");
    expect(sql).not.toContain("attended");
    expect(sql).not.toContain("no_show");
  });

  it("keeps the two-hour boundary inclusive and leaves paid no-shows irrelevant", () => {
    expect(sql).toContain("game.starts_at <= clock_timestamp() - v_referral_completion_delay");
    expect(sql).not.toContain("booking_attendance");
    expect(sql).not.toContain("no_show");
  });

  it("uses locked relationship and booking locks with a fresh revalidation", () => {
    expect(sql).toContain("for update of relationship skip locked");
    expect(sql).toContain("for update of booking");
    expect(sql).toContain("separate read committed statement after the booking lock");

    const bookingLock = sql.indexOf("for update of booking");
    const revalidation = sql.indexOf("where booking.id = v_candidate.booking_id");
    const credit = sql.indexOf("from public.create_wallet_credit_once(");

    expect(bookingLock).toBeGreaterThan(-1);
    expect(revalidation).toBeGreaterThan(bookingLock);
    expect(credit).toBeGreaterThan(revalidation);
  });

  it("issues one auditable promotion credit and rejects mismatched idempotency reuse", () => {
    expect(sql).toContain("p_amount => v_relationship.referred_reward_amount");
    expect(sql).toContain("p_currency => 'gbp'");
    expect(sql).toContain("p_transaction_type => 'promotion_bonus'");
    expect(sql).toContain(
      "p_idempotency_key => v_relationship.referred_reward_unlock_idempotency_key"
    );
    expect(sql).toContain("referral reward wallet transaction conflicts");
    expect(sql).toContain("referred_reward_state = 'unlocked'");
    expect(sql).toContain("referred_reward_wallet_transaction_id = v_wallet_transaction_id");
    expect(sql).toContain("referred_reward_unlock_booking_id = v_revalidated_candidate.booking_id");
    expect(sql).toContain("referred_reward_unlock_game_id = v_revalidated_candidate.game_id");

    const updateStart = sql.indexOf("update public.referral_relationships as relationship");
    const updateEnd = sql.indexOf("if not found then", updateStart);
    expect(sql.slice(updateStart, updateEnd)).not.toContain("referrer_reward_state");
  });

  it("is service-role-only and does not recreate loyalty logic", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function public.reconcile_referral_reward_unlocks(integer)");
    expect(sql).toContain(
      "grant execute on function public.reconcile_referral_reward_unlocks(integer)\n  to service_role"
    );
    expect(sql).not.toContain("insert into public.loyalty_booking_contributions");
    expect(sql).not.toContain("reconcile_loyalty_rewards");
  });
});
