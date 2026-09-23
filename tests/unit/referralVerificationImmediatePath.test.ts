import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const runReferralVerificationReconciliationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/referralRewards", () => ({
  runReferralVerificationReconciliation:
    runReferralVerificationReconciliationMock,
}));

import { POST } from "@/app/api/referrals/verification-reconcile/route";

const profileSource = readFileSync(
  join(process.cwd(), "app/profile/page.tsx"),
  "utf8"
);

function request(token?: string) {
  return new Request("http://localhost/api/referrals/verification-reconcile", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runReferralVerificationReconciliationMock.mockResolvedValue({
    relationships_checked: 1,
    referrals_processed: 1,
    wallet_credits_issued: 1,
  });
});

describe("immediate referral verification route", () => {
  it("rejects missing or invalid authentication", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(runReferralVerificationReconciliationMock).not.toHaveBeenCalled();
  });

  it("does not reconcile an unconfirmed server-authenticated user", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      id: "user-id",
      email_confirmed_at: null,
    });

    const response = await POST(request("access-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: false });
    expect(runReferralVerificationReconciliationMock).not.toHaveBeenCalled();
  });

  it("reconciles a confirmed user without accepting a request body", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      id: "user-id",
      email_confirmed_at: "2026-09-23T10:00:00.000Z",
    });

    const response = await POST(request("access-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true });
    expect(getAuthenticatedUserMock).toHaveBeenCalledWith("Bearer access-token");
    expect(runReferralVerificationReconciliationMock).toHaveBeenCalledTimes(1);
  });

  it("returns a generic error when reconciliation fails", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      id: "user-id",
      email_confirmed_at: "2026-09-23T10:00:00.000Z",
    });
    runReferralVerificationReconciliationMock.mockRejectedValueOnce(
      new Error("private database details")
    );

    const response = await POST(request("access-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to process referral verification.",
    });
  });
});

describe("profile verification-return integration", () => {
  it("only requests reconciliation from the complete_profile flow", () => {
    expect(profileSource).toContain("complete_profile");
    expect(profileSource).toContain(
      'fetch("/api/referrals/verification-reconcile", {'
    );
    expect(profileSource).toContain("Authorization: `Bearer ${session.access_token}`");
    expect(profileSource).toContain('method: "POST"');
    expect(profileSource).toContain("void requestReferralVerificationReconciliation()");
    expect(profileSource).not.toContain("referrer_user_id");
    expect(profileSource).not.toContain("wallet_transaction_id");
  });
});
