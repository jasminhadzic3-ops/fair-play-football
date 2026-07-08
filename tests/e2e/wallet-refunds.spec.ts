import { expect, test } from "@playwright/test";
import { signInWithEmail } from "./helpers/auth";
import {
  cleanupMoneyFlowSeed,
  createE2ESupabaseClient,
  getRefundRequestsForSourceCredit,
  getWalletBalanceBreakdown,
  seedWalletRefundFlow,
  type MoneyFlowSeed,
} from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";
import type { SupabaseClient } from "@supabase/supabase-js";

test.describe("wallet refund flow", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "DB-mutating wallet refund E2E requires E2E_ALLOW_DB_MUTATION=true."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const seeds: MoneyFlowSeed[] = [];

  test.beforeAll(() => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  });

  test.afterEach(async () => {
    const seed = seeds.pop();

    if (seed) {
      await cleanupMoneyFlowSeed(supabase, seed);
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

    await expect(
      page.getByText("Refund request sent. This amount is now reserved until an admin processes it.")
    ).toBeVisible();
    await expect(page.getByText("Refund requested")).toBeVisible();

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
});
