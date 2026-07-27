import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const gameCardSource = readFileSync(join(process.cwd(), "components/games/GameCard.tsx"), "utf8");

describe("homepage game calendar source", () => {
  it("adds a weekly calendar strip without changing GameCard source", () => {
    expect(homePageSource).toContain("weekDateKeys.map");
    expect(homePageSource).toContain("aria-pressed={isSelected}");
    expect(homePageSource).toContain("[scroll-snap-type:x_mandatory]");
    expect(homePageSource).toContain("Show previous week");
    expect(homePageSource).toContain("Today");
    expect(homePageSource).toContain("Show next week");
    expect(gameCardSource).toContain("Kickoff");
    expect(gameCardSource).toContain("GameDetails");
  });

  it("uses London starts_at grouping and preserves public game exclusions", () => {
    expect(homePageSource).toContain("getGameLondonDateKey");
    expect(homePageSource).toContain("sortGamesByStartsAt");
    expect(homePageSource).toContain('.eq("status", "active")');
    expect(homePageSource).toContain('.is("archived_at", null)');
  });

  it("keeps legacy null starts_at games visible in a fallback section", () => {
    expect(homePageSource).toContain("legacyGames");
    expect(homePageSource).toContain("Date not available");
    expect(homePageSource).toContain("not counted in the calendar");
  });

  it("keeps payment return and open-details wiring on the shared card renderer", () => {
    expect(homePageSource).toContain("const renderGameCard = (game: any)");
    expect(homePageSource).toContain("clearSumUpCheckoutReferenceFromUrl()");
    expect(homePageSource).toContain("fairPlayBookingsUpdatedAt");
    expect(homePageSource).toContain("openDetails={openDetailsGameId === game.id}");
    expect(homePageSource).toContain("selectedDatedGames.map(renderGameCard)");
    expect(homePageSource).toContain("legacyGames.map(renderGameCard)");
  });
});
