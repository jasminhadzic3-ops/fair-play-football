import { expect, test } from "@playwright/test";
import { signInWithEmail } from "./helpers/auth";
import {
  cleanupAdminSeed,
  cleanupMoneyFlowSeed,
  createE2ESupabaseClient,
  getRefundCompletedDebitsForRequest,
  getRefundRequestsForSourceCredit,
  getSumUpRefundAttemptsForRequest,
  getWalletBalanceBreakdown,
  seedAdminUser,
  seedWalletRefundFlow,
  type AdminSeed,
  type MoneyFlowSeed,
} from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";
import type { SupabaseClient } from "@supabase/supabase-js";

const testSupabaseRef = "gtrpegnxhawmkbhyqedh";

function canRunMockSumUpRefundE2E() {
  return (
    canRunDatabaseMutationE2E() &&
    process.env.E2E_MOCK_SUMUP_REFUNDS === "true" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(`${testSupabaseRef}.supabase.co`) === true
  );
}

function mockRefundOutcome() {
  return process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME || "succeeded";
}

test.describe("wallet refund flow", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "DB-mutating wallet refund E2E requires E2E_ALLOW_DB_MUTATION=true."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const seeds: MoneyFlowSeed[] = [];
  const adminSeeds: AdminSeed[] = [];

  test.beforeAll(() => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  });

  test.afterEach(async () => {
    const seed = seeds.pop();
    const adminSeed = adminSeeds.pop();

    if (seed) {
      await cleanupMoneyFlowSeed(supabase, seed);
    }

    if (adminSeed) {
      await cleanupAdminSeed(supabase, adminSeed);
    }
  });

  test("wallet page shows available, total, and reserved refund balances", async ({ page }) => {
    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 20,
      seedPendingRefundRequest: true,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);
    await page.getByRole("link", { name: "Wallet" }).click();

    const balanceSection = page.locator("section").filter({ hasText: "Available balance" });

    await expect(balanceSection).toContainText("Available balance");
    await expect(balanceSection).toContainText("£0.00");
    await expect(balanceSection).toContainText("Total wallet balance");
    await expect(balanceSection).toContainText("£20.00");
    await expect(balanceSection).toContainText("Reserved for refunds");
    await expect(balanceSection).toContainText("£20.00");
  });

  test("player can request a refund from an eligible SumUp cancellation credit", async ({ page }) => {
    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 15,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);
    await page.goto("/wallet");

    await page.getByRole("button", { name: "Request refund" }).click();

    await expect(page.getByText("Refund requested; awaiting processing.")).toBeVisible();
    await expect(page.locator("span").filter({ hasText: /^Refund requested$/ })).toBeVisible();

    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      seed.player.id,
      seed.sourceCredit.id
    );

    expect(refundRequests).toHaveLength(1);
    expect(refundRequests[0]).toMatchObject({
      amount: -15,
      status: "pending",
    });
    expect(refundRequests[0].metadata).toMatchObject({
      source_wallet_transaction_id: seed.sourceCredit.id,
      original_payment_method: "sumup",
      original_payment_id: seed.payment.id,
    });
  });

  test("refund request reserves the source credit and reduces available balance", async ({ page }) => {
    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 18,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);

    await expect.poll(async () => {
      return getWalletBalanceBreakdown(supabase, seed.player.id);
    }).toEqual({
      completedBalance: 18,
      reservedRefundAmount: 0,
      availableBalance: 18,
    });

    await page.goto("/wallet");
    await page.getByRole("button", { name: "Request refund" }).click();

    await expect.poll(async () => {
      return getWalletBalanceBreakdown(supabase, seed.player.id);
    }).toEqual({
      completedBalance: 18,
      reservedRefundAmount: 18,
      availableBalance: 0,
    });

    const balanceSection = page.locator("section").filter({ hasText: "Available balance" });

    await expect(balanceSection).toContainText("£0.00");
    await expect(balanceSection).toContainText("£18.00");
  });

  test("player presses Refund and completes automatically with mocked SumUp", async ({ page }) => {
    test.skip(
      !canRunMockSumUpRefundE2E() || mockRefundOutcome() !== "succeeded",
      "Mocked automatic SumUp refund E2E requires TEST Supabase ref, E2E_ALLOW_DB_MUTATION=true, E2E_MOCK_SUMUP_REFUNDS=true, and a succeeded mock outcome."
    );

    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 12,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);
    await page.goto("/wallet");
    await page.getByRole("button", { name: "Request refund" }).click();

    await expect(page.getByText("Refund completed.")).toBeVisible();
    await expect(page.locator("span").filter({ hasText: /^Refund completed$/ })).toBeVisible();

    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      seed.player.id,
      seed.sourceCredit.id
    );

    expect(refundRequests).toHaveLength(1);
    const refundRequestId = Number(refundRequests[0].id);
    const refundAttempts = await getSumUpRefundAttemptsForRequest(supabase, refundRequestId);
    const completedDebits = await getRefundCompletedDebitsForRequest(
      supabase,
      seed.player.id,
      refundRequestId
    );

    expect(refundRequests[0].status).toBe("completed");
    expect(refundAttempts).toHaveLength(1);
    expect(refundAttempts[0]).toMatchObject({
      refund_request_id: refundRequestId,
      booking_payment_id: seed.payment.id,
      source_wallet_transaction_id: seed.sourceCredit.id,
      status: "succeeded",
    });
    expect(completedDebits).toHaveLength(1);
    expect(Number(completedDebits[0].amount)).toBe(-12);
    await expect.poll(async () => getWalletBalanceBreakdown(supabase, seed.player.id)).toEqual({
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    });
  });

  test("double-click and reload produce one mocked attempt and one completed debit", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);

    test.skip(
      !canRunMockSumUpRefundE2E() || mockRefundOutcome() !== "succeeded",
      "Mocked automatic SumUp refund E2E requires TEST Supabase ref, E2E_ALLOW_DB_MUTATION=true, E2E_MOCK_SUMUP_REFUNDS=true, and a succeeded mock outcome."
    );

    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 10,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);
    await page.goto("/wallet");

    const refundButton = page.getByRole("button", { name: "Request refund" });
    await refundButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await expect
      .poll(async () => {
        const refundRequests = await getRefundRequestsForSourceCredit(
          supabase,
          seed.player.id,
          seed.sourceCredit.id
        );

        if (refundRequests.length !== 1) {
          return { refundRequests: refundRequests.length, attempts: 0, debits: 0 };
        }

        const refundRequestId = Number(refundRequests[0].id);
        const refundAttempts = await getSumUpRefundAttemptsForRequest(supabase, refundRequestId);
        const completedDebits = await getRefundCompletedDebitsForRequest(
          supabase,
          seed.player.id,
          refundRequestId
        );

        return {
          refundRequests: refundRequests.length,
          attempts: refundAttempts.length,
          debits: completedDebits.length,
        };
      })
      .toEqual({ refundRequests: 1, attempts: 1, debits: 1 });

    await page.reload();
    await expect(page.locator("span").filter({ hasText: /^Refund completed$/ })).toBeVisible();
  });

  test("unknown mocked automatic refund remains reserved and appears in admin recovery queue", async ({
    browser,
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);

    test.skip(
      !canRunMockSumUpRefundE2E() || mockRefundOutcome() !== "unknown",
      "Mocked unknown SumUp refund E2E requires TEST Supabase ref, E2E_ALLOW_DB_MUTATION=true, E2E_MOCK_SUMUP_REFUNDS=true, and E2E_MOCK_SUMUP_REFUND_OUTCOME=unknown."
    );

    const adminSeed = await seedAdminUser(supabase);
    adminSeeds.push(adminSeed);
    const seed = await seedWalletRefundFlow(supabase, {
      creditAmount: 9,
    });
    seeds.push(seed);

    await signInWithEmail(page, seed.player.email, seed.player.password);
    await page.goto("/wallet");
    await page.getByRole("button", { name: "Request refund" }).click();

    await expect(
      page.getByText("Refund needs review; your wallet credit remains reserved.")
    ).toBeVisible();

    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      seed.player.id,
      seed.sourceCredit.id
    );
    expect(refundRequests).toHaveLength(1);
    expect(refundRequests[0].status).toBe("processing");

    await expect.poll(async () => getWalletBalanceBreakdown(supabase, seed.player.id)).toEqual({
      completedBalance: 9,
      reservedRefundAmount: 9,
      availableBalance: 0,
    });

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      await signInWithEmail(adminPage, adminSeed.admin.email, adminSeed.admin.password);
      await adminPage.goto("/admin");
      await expect(adminPage.getByRole("heading", { name: "Refund Requests" })).toBeVisible();
      await expect(adminPage.getByText(seed.player.email, { exact: true })).toBeVisible();
      await expect(adminPage.getByText("SumUp outcome is unknown")).toBeVisible();
    } finally {
      await adminContext.close();
    }
  });
});
