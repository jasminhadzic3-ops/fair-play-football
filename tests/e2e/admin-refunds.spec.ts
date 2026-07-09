import { expect, test, type Dialog, type Page } from "@playwright/test";
import { signInWithEmail } from "./helpers/auth";
import {
  cleanupAdminSeed,
  cleanupMoneyFlowSeed,
  createE2ESupabaseClient,
  getRefundCompletedDebitsForRequest,
  getRefundRequestsForSourceCredit,
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

function acceptAdminRefundDialogs(page: Page, promptText: string) {
  const handler = async (dialog: Dialog) => {
    if (dialog.type() === "prompt") {
      await dialog.accept(promptText);
      return;
    }

    await dialog.accept();
  };

  page.on("dialog", handler);

  return () => page.off("dialog", handler);
}

function refundRequestCard(page: Page, seed: MoneyFlowSeed) {
  return page
    .getByText(seed.player.email, { exact: true })
    .locator(
      "xpath=ancestor::div[.//button[normalize-space()='Mark Refunded'] and .//button[normalize-space()='Reject']][1]"
    );
}

async function seedPendingAdminRefund(
  supabase: SupabaseClient,
  adminSeeds: AdminSeed[],
  moneySeeds: MoneyFlowSeed[],
  creditAmount: number
) {
  const adminSeed = await seedAdminUser(supabase);
  adminSeeds.push(adminSeed);

  const moneySeed = await seedWalletRefundFlow(supabase, {
    creditAmount,
    seedPendingRefundRequest: true,
  });
  moneySeeds.push(moneySeed);

  const refundRequests = await getRefundRequestsForSourceCredit(
    supabase,
    moneySeed.player.id,
    moneySeed.sourceCredit.id
  );

  expect(refundRequests).toHaveLength(1);

  return {
    adminSeed,
    moneySeed,
    refundRequestId: Number(refundRequests[0].id),
  };
}

async function openAdminRefundQueue(page: Page, adminSeed: AdminSeed) {
  await signInWithEmail(page, adminSeed.admin.email, adminSeed.admin.password);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refund Requests" })).toBeVisible();
}

test.describe("admin refund processing", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "DB-mutating admin refund E2E requires E2E_ALLOW_DB_MUTATION=true."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const adminSeeds: AdminSeed[] = [];
  const moneySeeds: MoneyFlowSeed[] = [];

  test.beforeAll(() => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  });

  test.afterEach(async () => {
    const moneySeed = moneySeeds.pop();
    const adminSeed = adminSeeds.pop();

    if (moneySeed) {
      await cleanupMoneyFlowSeed(supabase, moneySeed);
    }

    if (adminSeed) {
      await cleanupAdminSeed(supabase, adminSeed);
    }
  });

  test("admin refund queue displays a seeded pending refund request", async ({ page }) => {
    const { adminSeed, moneySeed } = await seedPendingAdminRefund(
      supabase,
      adminSeeds,
      moneySeeds,
      20
    );

    await openAdminRefundQueue(page, adminSeed);

    const card = refundRequestCard(page, moneySeed);

    await expect(card).toBeVisible();
    await expect(card).toContainText(moneySeed.player.username);
    await expect(card).toContainText(moneySeed.player.email);
    await expect(card).toContainText("£20.00");
    await expect(card).toContainText(`E2E Wallet Refund ${moneySeed.runId}`);
    await expect(card).toContainText(`Payment ${moneySeed.payment.id}`);
    await expect(card).toContainText(`Credit ${moneySeed.sourceCredit.id}`);
    await expect(card).toContainText(`SumUp ${moneySeed.runId}_txn_code`);
    await expect(card.getByRole("button", { name: "Mark Refunded" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("admin rejects a pending refund request and releases the reservation", async ({ page }) => {
    const { adminSeed, moneySeed, refundRequestId } = await seedPendingAdminRefund(
      supabase,
      adminSeeds,
      moneySeeds,
      16
    );

    await openAdminRefundQueue(page, adminSeed);

    const removeDialogs = acceptAdminRefundDialogs(page, "E2E reject");

    await refundRequestCard(page, moneySeed).getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText(moneySeed.player.email)).toHaveCount(0);

    removeDialogs();

    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      moneySeed.player.id,
      moneySeed.sourceCredit.id
    );
    const completedDebits = await getRefundCompletedDebitsForRequest(
      supabase,
      moneySeed.player.id,
      refundRequestId
    );
    const balanceBreakdown = await getWalletBalanceBreakdown(supabase, moneySeed.player.id);

    expect(refundRequests).toHaveLength(1);
    expect(refundRequests[0].status).toBe("cancelled");
    expect(completedDebits).toHaveLength(0);
    expect(balanceBreakdown).toEqual({
      completedBalance: 16,
      reservedRefundAmount: 0,
      availableBalance: 16,
    });
  });

  test("admin manually marks a refund as refunded and creates one wallet debit", async ({ page }) => {
    const sumupRefundUrls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();

      if (url.includes("/refunds")) {
        sumupRefundUrls.push(url);
      }
    });

    const { adminSeed, moneySeed, refundRequestId } = await seedPendingAdminRefund(
      supabase,
      adminSeeds,
      moneySeeds,
      14
    );

    await openAdminRefundQueue(page, adminSeed);

    const removeDialogs = acceptAdminRefundDialogs(page, "E2E manual refund");

    await refundRequestCard(page, moneySeed)
      .getByRole("button", { name: "Mark Refunded" })
      .click();
    await expect(page.getByText(moneySeed.player.email)).toHaveCount(0);

    removeDialogs();

    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      moneySeed.player.id,
      moneySeed.sourceCredit.id
    );
    const completedDebits = await getRefundCompletedDebitsForRequest(
      supabase,
      moneySeed.player.id,
      refundRequestId
    );
    const balanceBreakdown = await getWalletBalanceBreakdown(supabase, moneySeed.player.id);

    expect(refundRequests).toHaveLength(1);
    expect(refundRequests[0].status).toBe("completed");
    expect(completedDebits).toHaveLength(1);
    expect(Number(completedDebits[0].amount)).toBe(-14);
    expect(completedDebits[0].status).toBe("completed");
    expect(sumupRefundUrls).toHaveLength(0);
    expect(balanceBreakdown).toEqual({
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    });
  });
});
