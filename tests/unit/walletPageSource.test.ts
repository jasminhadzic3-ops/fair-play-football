import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const walletPageSource = readFileSync(join(process.cwd(), "app/wallet/page.tsx"), "utf8");

describe("wallet page source", () => {
  it("only shows the refund action when the available balance can cover the source credit", () => {
    expect(walletPageSource).toContain("Number(transaction.amount) <= availableBalance");
    expect(walletPageSource).toContain('setRefundMessage("Refund amount cannot be greater than your wallet balance.")');
  });
});
