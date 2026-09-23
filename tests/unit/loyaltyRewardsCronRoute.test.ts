import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runLoyaltyRewardsReconciliationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/loyaltyRewards", () => ({
  runLoyaltyRewardsReconciliation: runLoyaltyRewardsReconciliationMock,
}));

import { GET } from "@/app/api/cron/loyalty-rewards/route";

const repoRoot = process.cwd();

function cronRequest(secret?: string) {
  return new Request("http://localhost/api/cron/loyalty-rewards", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  }) as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  runLoyaltyRewardsReconciliationMock.mockResolvedValue({
    bookings_checked: 5,
    contributions_created: 5,
    rewards_issued: 1,
    negative_adjustments_applied: 0,
  });
});

describe("loyalty rewards cron route", () => {
  it("rejects requests without authorization", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(runLoyaltyRewardsReconciliationMock).not.toHaveBeenCalled();
  });

  it("rejects requests with an incorrect bearer secret", async () => {
    const response = await GET(cronRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(runLoyaltyRewardsReconciliationMock).not.toHaveBeenCalled();
  });

  it("rejects requests when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("cron-secret"));

    expect(response.status).toBe(401);
    expect(runLoyaltyRewardsReconciliationMock).not.toHaveBeenCalled();
  });

  it("runs reconciliation once and returns its summary", async () => {
    const response = await GET(cronRequest("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runLoyaltyRewardsReconciliationMock).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      bookings_checked: 5,
      contributions_created: 5,
      rewards_issued: 1,
      negative_adjustments_applied: 0,
    });
  });

  it("returns 500 when reconciliation fails", async () => {
    runLoyaltyRewardsReconciliationMock.mockRejectedValueOnce(new Error("RPC failed"));

    const response = await GET(cronRequest("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unable to reconcile loyalty rewards." });
  });
});

describe("loyalty rewards cron configuration and implementation", () => {
  it("preserves the reminder cron and runs loyalty reconciliation hourly", () => {
    const vercelConfig = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8"));

    expect(
      vercelConfig.crons.filter(
        (cron: { path: string }) => cron.path === "/api/cron/game-reminders"
      )
    ).toEqual([
      {
        path: "/api/cron/game-reminders",
        schedule: "5 9 * * *",
      },
    ]);
    expect(
      vercelConfig.crons.filter(
        (cron: { path: string }) => cron.path === "/api/cron/loyalty-rewards"
      )
    ).toEqual([
      {
        path: "/api/cron/loyalty-rewards",
        schedule: "45 * * * *",
      },
    ]);
  });

  it("keeps the helper server-only and delegates business logic to the RPC", () => {
    const helperSource = readFileSync(join(repoRoot, "lib/loyaltyRewards.ts"), "utf8");
    const routeSource = readFileSync(
      join(repoRoot, "app/api/cron/loyalty-rewards/route.ts"),
      "utf8"
    );

    expect(helperSource).toContain('import "server-only"');
    expect(helperSource).toContain("assertSupabaseAdminConfigured");
    expect(helperSource).toContain('supabaseAdmin.rpc("reconcile_loyalty_rewards"');
    expect(helperSource).toContain("p_booking_limit: 500");
    expect(helperSource).toContain("bookings_checked");
    expect(helperSource).toContain("contributions_created");
    expect(helperSource).toContain("rewards_issued");
    expect(helperSource).toContain("negative_adjustments_applied");
    expect(helperSource).not.toContain("booking_source");
    expect(helperSource).not.toContain("wallet_booking_payment");
    expect(helperSource).not.toContain("starts_at");
    expect(routeSource).not.toContain("booking_source");
    expect(routeSource).not.toContain("wallet_booking_payment");
    expect(routeSource).not.toContain("starts_at");
  });
});
