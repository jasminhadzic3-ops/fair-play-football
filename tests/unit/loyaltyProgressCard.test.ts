import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const cardSource = readFileSync(
  resolve(repoRoot, "components/wallet/LoyaltyProgressCard.tsx"),
  "utf8"
);
const walletSource = readFileSync(resolve(repoRoot, "app/wallet/page.tsx"), "utf8");

describe("player loyalty progress card", () => {
  it("loads the authenticated read-only progress RPC and preserves Wallet placement", () => {
    expect(cardSource).toContain('supabase.rpc("get_my_loyalty_progress")');
    expect(walletSource).toContain('import LoyaltyProgressCard from "@/components/wallet/LoyaltyProgressCard"');
    expect(walletSource.indexOf("<LoyaltyProgressCard userId={userId} />")).toBeGreaterThan(
      walletSource.indexOf("Available balance")
    );
    expect(walletSource.indexOf("<LoyaltyProgressCard userId={userId} />")).toBeLessThan(
      walletSource.indexOf("Recent activity")
    );
  });

  it("supports the approved premium rewards copy and dynamic progress", () => {
    expect(cardSource).toContain("Play 5 games. Get your 6th free.");
    expect(cardSource).toContain("Complete five qualifying Fair Play games and receive £5 wallet credit towards your sixth game.");
    expect(cardSource).toContain("The reward repeats automatically, each time you complete another five qualifying games, you’ll receive another £5 credit towards your next game.");
    expect(cardSource).toContain("of {progress.target} games completed");
    expect(cardSource).toContain("6TH GAME FREE");
  });

  it("renders exactly five capped visual markers and links to the public rewards explanation", () => {
    expect(cardSource).toContain("Array.from({ length: 5 }");
    expect(cardSource).toContain("Math.min(progress.current_progress, progress.target)");
    expect(cardSource).toContain('href="/rewards"');
    expect(cardSource).toContain("How Fair Play Rewards work");
  });

  it("fails softly when the RPC is unavailable and does not recreate eligibility logic", () => {
    expect(cardSource).toContain("Rewards progress is currently unavailable");
    expect(cardSource).toContain("setHasError(true)");
    expect(cardSource).not.toContain("from(\"bookings\")");
    expect(cardSource).not.toContain("from(\"booking_payments\")");
    expect(cardSource).not.toContain("booking_source");
    expect(cardSource).not.toContain("attendance");
    expect(cardSource).not.toContain("payment_status");
    expect(cardSource).not.toContain("reconcile_loyalty_rewards");
  });
});
