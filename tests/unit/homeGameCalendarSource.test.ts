import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "components/home/HomeClient.tsx"), "utf8");
const gameCardSource = readFileSync(join(process.cwd(), "components/games/GameCard.tsx"), "utf8");
const globalStylesSource = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("homepage game calendar source", () => {
  it("adds a weekly calendar strip without changing GameCard source", () => {
    expect(homePageSource).toContain("weekDateKeys.map");
    expect(homePageSource).toContain("aria-pressed={isSelected}");
    expect(homePageSource).toContain("[scroll-snap-type:x_mandatory]");
    expect(homePageSource).toContain("grid min-w-max grid-cols-7 gap-2.5 md:w-full md:min-w-0");
    expect(homePageSource).toContain("w-[6.6rem]");
    expect(homePageSource).toContain("md:w-full");
    expect(homePageSource).toContain("Show previous week");
    expect(homePageSource).toContain("Today");
    expect(homePageSource).toContain("Show next week");
    expect(gameCardSource).toContain("Kickoff");
    expect(gameCardSource).toContain("GameDetails");
  });

  it("keeps week navigation directional and lightly animated", () => {
    expect(homePageSource).toContain("weekNavigationDirection");
    expect(homePageSource).toContain('setWeekNavigationDirection("previous")');
    expect(homePageSource).toContain('setWeekNavigationDirection("next")');
    expect(homePageSource).toContain("calendar-week-slide-next");
    expect(homePageSource).toContain("calendar-week-slide-previous");
    expect(homePageSource).toContain("setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, -7))");
    expect(homePageSource).toContain("setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, 7))");
    expect(globalStylesSource).toContain("@keyframes calendar-week-slide-next");
    expect(globalStylesSource).toContain("@keyframes calendar-week-slide-previous");
    expect(globalStylesSource).toContain("220ms ease-out");
    expect(globalStylesSource).toContain("prefers-reduced-motion: reduce");
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
