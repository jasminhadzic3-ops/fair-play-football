import "server-only";

import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

export type ReferralVerificationReconciliationSummary = {
  relationships_checked: number;
  referrals_processed: number;
  wallet_credits_issued: number;
};

function normalizeCount(value: unknown, field: string) {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(count)) {
    throw new Error(`Invalid referral reconciliation response field: ${field}`);
  }

  return count;
}

export async function runReferralVerificationReconciliation(): Promise<ReferralVerificationReconciliationSummary> {
  assertSupabaseAdminConfigured();

  const { data, error } = await supabaseAdmin.rpc("reconcile_referral_verifications", {
    p_relationship_limit: 100,
  });

  if (error) {
    throw error;
  }

  const summary = Array.isArray(data) ? data[0] : data;

  if (!summary || typeof summary !== "object") {
    throw new Error("Referral reconciliation returned no summary.");
  }

  const row = summary as Record<string, unknown>;

  return {
    relationships_checked: normalizeCount(
      row.relationships_checked,
      "relationships_checked"
    ),
    referrals_processed: normalizeCount(
      row.referrals_processed,
      "referrals_processed"
    ),
    wallet_credits_issued: normalizeCount(
      row.wallet_credits_issued,
      "wallet_credits_issued"
    ),
  };
}
