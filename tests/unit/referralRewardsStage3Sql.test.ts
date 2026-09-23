import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(
      repoRoot,
      "supabase/migrations/20260922170000_add_referral_verification_reconciliation.sql"
    ),
    "utf8"
  ).toLowerCase();
}

describe("referral verification reconciliation migration", () => {
  it("uses authoritative email confirmation and locks pending relationships", () => {
    const sql = readMigration();

    expect(sql).toContain("auth.users as auth_user");
    expect(sql).toContain("auth_user.email_confirmed_at is not null");
    expect(sql).toContain("for update of relationship skip locked");
    expect(sql).toContain("select auth_user.email_confirmed_at");
    expect(sql).toContain("email_verification_state = 'pending_verification'");
    expect(sql).toContain("referrer_reward_state = 'pending_verification'");
    expect(sql).toContain("referred_reward_state = 'pending_verification'");
  });

  it("uses fixed promotion credit values and captures the wallet transaction", () => {
    const sql = readMigration();

    expect(sql).toContain("p_amount => 5.00");
    expect(sql).toContain("p_currency => 'gbp'");
    expect(sql).toContain("p_transaction_type => 'promotion_bonus'");
    expect(sql).toContain("p_idempotency_key => v_relationship.referrer_reward_idempotency_key");
    expect(sql).toContain("credit.success");
    expect(sql).toContain("credit.transaction_id");
    expect(sql).toContain("referrer_reward_wallet_transaction_id = v_wallet_transaction_id");
  });

  it("transitions the referred reward to locked without creating its wallet transaction", () => {
    const sql = readMigration();

    expect(sql).toContain("email_verification_state = 'verified'");
    expect(sql).toContain("referrer_reward_state = 'credited'");
    expect(sql).toContain("referred_reward_state = 'locked'");
    expect(sql).toContain("referred_reward_locked_at = clock_timestamp()");
    expect(sql).not.toContain("referred_reward_wallet_transaction_id =");
    expect(sql).not.toContain("insert into public.wallet_transactions");
  });

  it("is service-role-only with definer protections and a bounded batch", () => {
    const sql = readMigration();

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("p_relationship_limit integer default 100");
    expect(sql).toContain("p_relationship_limit > 500");
    expect(sql).toContain(
      "revoke all on function public.reconcile_referral_verifications(integer)"
    );
    expect(sql).toContain(
      "grant execute on function public.reconcile_referral_verifications(integer)\n  to service_role"
    );
  });
});
