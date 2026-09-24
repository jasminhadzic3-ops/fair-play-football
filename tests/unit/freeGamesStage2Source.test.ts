import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Free Games Stage 2 integration", () => {
  it("keeps pricing mode server authoritative in admin create and edit routes", () => {
    const create = read("app/api/admin/games/route.ts");
    const edit = read("app/api/admin/games/[id]/route.ts");
    expect(create).toContain('pricingMode === "free" ? 0');
    expect(create).toContain("pricing_mode: pricingMode");
    expect(edit).toContain('from("wallet_transactions")');
    expect(read("app/admin/page.tsx")).toContain("Booking type cannot be changed after bookings or financial history exist.");
  });

  it("uses the dedicated free route and hides paid choices for free games", () => {
    const details = read("components/games/GameDetails.tsx");
    expect(details).toContain('const isFreeGame = game.pricing_mode === "free"');
    expect(details).toContain('fetch("/api/free-bookings"');
    expect(details).toContain('"Book free place"');
    expect(details).toContain("!isFreeGame ? <div");
    expect(details).toContain('{isFreeGame ? "FREE"');
  });

  it("presents free games without £0 or payment wording in cards and My Bookings", () => {
    expect(read("components/games/GameCard.tsx")).toContain('game.pricing_mode === "free" ? "FREE"');
    const myBookings = read("app/my-bookings/page.tsx");
    expect(myBookings).toContain('game.pricing_mode === "free" ? "FREE"');
    expect(myBookings).toContain('game.pricing_mode !== "free"');
  });
});
