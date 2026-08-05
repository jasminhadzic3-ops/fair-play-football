import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const walletPageSource = readFileSync(join(process.cwd(), "app/wallet/page.tsx"), "utf8");

describe("wallet page source", () => {
  it("only shows the refund action when the available balance can cover the source credit", () => {
    expect(walletPageSource).toContain("Number(transaction.amount) <= availableBalance");
    expect(walletPageSource).toContain('setRefundMessage("Refund amount cannot be greater than your wallet balance.")');
  });

  it("uses the related game kickoff and title for wallet activity rows", () => {
    expect(walletPageSource).toContain('.from("games")');
    expect(walletPageSource).toContain('.select("id,title,starts_at,time")');
    expect(walletPageSource).toContain('getMetadataPositiveInteger(transaction.metadata, "original_game_id")');
    expect(walletPageSource).toContain(".map(getWalletActivityGameId)");
    expect(walletPageSource).toContain("formatGameKickoff(activityGame)");
    expect(walletPageSource).toContain("const primaryLabel = activityGame?.title?.trim() || description");
    expect(walletPageSource).toContain("const activityDescription = activityGame ? description : \"\"");
    expect(walletPageSource).toContain("formatWalletActivityLedgerDate(transaction, ledgerDate)");
    expect(walletPageSource).toContain("Credited on ${ledgerDate}");
    expect(walletPageSource).toContain("Paid on ${ledgerDate}");
    expect(walletPageSource).toContain("Requested on ${ledgerDate}");
    expect(walletPageSource).toContain("Refunded on ${ledgerDate}");
  });
});
