import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runReferralVerificationReconciliationMock = vi.hoisted(() => vi.fn());
const runReferralRewardUnlockReconciliationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/referralRewards", () => ({
  runReferralVerificationReconciliation:
    runReferralVerificationReconciliationMock,
  runReferralRewardUnlockReconciliation:
    runReferralRewardUnlockReconciliationMock,
}));

import { GET } from "@/app/api/cron/referral-rewards/route";

function cronRequest(secret?: string) {
  return new Request("http://localhost/api/cron/referral-rewards", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  }) as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  runReferralVerificationReconciliationMock.mockResolvedValue({
    relationships_checked: 2,
    referrals_processed: 1,
    wallet_credits_issued: 1,
  });
  runReferralRewardUnlockReconciliationMock.mockResolvedValue({
    relationships_checked: 2,
    referrals_unlocked: 1,
    wallet_credits_issued: 1,
  });
});

describe("referral rewards cron route", () => {
  it("does not register referral rewards with Vercel Cron because QStash owns scheduling", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };

    expect(
      vercel.crons.filter(
        (cron) => cron.path === "/api/cron/referral-rewards"
      )
    ).toEqual([]);
  });

  it("rejects unauthorized requests without invoking reconciliation", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(runReferralVerificationReconciliationMock).not.toHaveBeenCalled();
    expect(runReferralRewardUnlockReconciliationMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect bearer secret", async () => {
    const response = await GET(cronRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(runReferralVerificationReconciliationMock).not.toHaveBeenCalled();
    expect(runReferralRewardUnlockReconciliationMock).not.toHaveBeenCalled();
  });

  it("rejects requests when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("cron-secret"));

    expect(response.status).toBe(401);
    expect(runReferralVerificationReconciliationMock).not.toHaveBeenCalled();
    expect(runReferralRewardUnlockReconciliationMock).not.toHaveBeenCalled();
  });

  it("runs reconciliation once and disables caching", async () => {
    const response = await GET(cronRequest("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runReferralVerificationReconciliationMock).toHaveBeenCalledTimes(1);
    expect(runReferralRewardUnlockReconciliationMock).toHaveBeenCalledTimes(1);
    expect(
      runReferralVerificationReconciliationMock.mock.invocationCallOrder[0]
    ).toBeLessThan(runReferralRewardUnlockReconciliationMock.mock.invocationCallOrder[0]);
    expect(body).toEqual({
      verification: {
        relationships_checked: 2,
        referrals_processed: 1,
        wallet_credits_issued: 1,
      },
      unlocks: {
        relationships_checked: 2,
        referrals_unlocked: 1,
        wallet_credits_issued: 1,
      },
    });
  });

  it("returns 500 without exposing internal errors", async () => {
    runReferralVerificationReconciliationMock.mockRejectedValueOnce(
      new Error("database failure")
    );

    const response = await GET(cronRequest("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Unable to reconcile referral rewards.",
    });
  });

  it("does not expose unlock reconciliation errors", async () => {
    runReferralRewardUnlockReconciliationMock.mockRejectedValueOnce(
      new Error("private database details")
    );

    const response = await GET(cronRequest("cron-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to reconcile referral rewards.",
    });
  });
});
