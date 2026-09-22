import "server-only";

import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

export type LoyaltyRewardsReconciliationSummary = {
  bookings_checked: number;
  contributions_created: number;
  rewards_issued: number;
  negative_adjustments_applied: number;
};

function normalizeCount(value: unknown, field: string) {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(count)) {
    throw new Error(`Invalid reconciliation response field: ${field}`);
  }

  return count;
}

export async function runLoyaltyRewardsReconciliation(): Promise<LoyaltyRewardsReconciliationSummary> {
  assertSupabaseAdminConfigured();

  const { data, error } = await supabaseAdmin.rpc("reconcile_loyalty_rewards", {
    p_booking_limit: 500,
  });

  if (error) {
    throw error;
  }

  const summary = Array.isArray(data) ? data[0] : data;

  if (!summary || typeof summary !== "object") {
    throw new Error("Loyalty reconciliation returned no summary.");
  }

  const row = summary as Record<string, unknown>;

  return {
    bookings_checked: normalizeCount(row.bookings_checked, "bookings_checked"),
    contributions_created: normalizeCount(
      row.contributions_created,
      "contributions_created"
    ),
    rewards_issued: normalizeCount(row.rewards_issued, "rewards_issued"),
    negative_adjustments_applied: normalizeCount(
      row.negative_adjustments_applied,
      "negative_adjustments_applied"
    ),
  };
}
