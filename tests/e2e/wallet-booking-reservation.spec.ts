import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInWithEmail } from "./helpers/auth";
import {
  cleanupMoneyFlowSeed,
  cleanupTargetGameSeed,
  createE2ESupabaseClient,
  getBookingsForUserAndGame,
  getRefundRequestsForSourceCredit,
  getWalletBalanceBreakdown,
  getWalletBookingDebitsForGame,
  seedActiveWalletBookingTargetGame,
  seedWalletRefundFlow,
  type MoneyFlowSeed,
  type TargetGameSeed,
} from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";

test.describe("reserved refund wallet booking protection", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "DB-mutating wallet booking reservation E2E requires E2E_ALLOW_DB_MUTATION=true."
  );
  test.describe.configure({ mode: "serial" });

  let supabase: SupabaseClient;
  const moneySeeds: MoneyFlowSeed[] = [];
  const targetGameSeeds: Array<{ seed: TargetGameSeed; playerId: string }> = [];

  test.beforeAll(() => {
    supabase = createE2ESupabaseClient(requireDatabaseMutationE2EEnv());
  });

  test.afterEach(async () => {
    const targetGameSeed = targetGameSeeds.pop();
    const moneySeed = moneySeeds.pop();

    if (targetGameSeed) {
      await cleanupTargetGameSeed(
        supabase,
        targetGameSeed.seed,
        targetGameSeed.playerId
      );
    }

    if (moneySeed) {
      await cleanupMoneyFlowSeed(supabase, moneySeed);
    }
  });

  test("pending refund reservation blocks spending the same wallet credit on another game", async ({ page }) => {
    const sumupEndpointUrls: string[] = [];

    page.on("request", (request) => {
      const url = request.url();

      if (url.includes("api.sumup.com") || url.includes("/api/sumup") || url.includes("/refunds")) {
        sumupEndpointUrls.push(url);
      }
    });

    const moneySeed = await seedWalletRefundFlow(supabase, {
      creditAmount: 10,
      seedPendingRefundRequest: true,
    });
    moneySeeds.push(moneySeed);

    const targetGameSeed = await seedActiveWalletBookingTargetGame(supabase, {
      price: 10,
    });
    targetGameSeeds.push({
      seed: targetGameSeed,
      playerId: moneySeed.player.id,
    });

    await expect.poll(async () => {
      return getWalletBalanceBreakdown(supabase, moneySeed.player.id);
    }).toEqual({
      completedBalance: 10,
      reservedRefundAmount: 10,
      availableBalance: 0,
    });

    await signInWithEmail(page, moneySeed.player.email, moneySeed.player.password);
    await page.getByRole("link", { name: "Find Games" }).click();
    await expect(page.locator("#games")).toBeVisible();

    const targetGameCard = page
      .locator("#games")
      .locator(".cursor-pointer")
      .filter({ hasText: targetGameSeed.game.title })
      .first();

    await expect(targetGameCard).toBeVisible();
    await targetGameCard.click();

    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    await page.getByRole("button", { name: "Join Game" }).click();
    await expect(page.getByText("Secure checkout")).toBeVisible();
    await page.getByRole("button", { name: "Pay £10 with Wallet" }).click();

    await expect(page.getByText("Insufficient wallet balance.")).toBeVisible();

    const targetGameBookings = await getBookingsForUserAndGame(
      supabase,
      moneySeed.player.id,
      targetGameSeed.game.id
    );
    const walletBookingDebits = await getWalletBookingDebitsForGame(
      supabase,
      moneySeed.player.id,
      targetGameSeed.game.id
    );
    const refundRequests = await getRefundRequestsForSourceCredit(
      supabase,
      moneySeed.player.id,
      moneySeed.sourceCredit.id
    );
    const balanceBreakdown = await getWalletBalanceBreakdown(supabase, moneySeed.player.id);

    expect(targetGameBookings).toHaveLength(0);
    expect(walletBookingDebits).toHaveLength(0);
    expect(refundRequests).toHaveLength(1);
    expect(refundRequests[0].status).toBe("pending");
    expect(balanceBreakdown).toEqual({
      completedBalance: 10,
      reservedRefundAmount: 10,
      availableBalance: 0,
    });
    expect(sumupEndpointUrls).toHaveLength(0);
  });
});
