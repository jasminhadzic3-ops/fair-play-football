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
    expect(homePageSource).toContain("All Games");
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
    expect(homePageSource).toContain("dateKey >= todayDateKey");
    expect(homePageSource).toContain('.eq("status", "active")');
    expect(homePageSource).toContain('.is("archived_at", null)');
  });

  it("uses green personal booking ticks and an all-games mode without changing the count badge", () => {
    expect(homePageSource).toContain("const [showAllGames, setShowAllGames] = useState(false)");
    expect(homePageSource).toContain("setShowAllGames(true)");
    expect(homePageSource).toContain("setSelectedGameDateKey(null)");
    expect(homePageSource).toContain("setShowAllGames(false)");
    expect(homePageSource).toContain("const hasUserBooking = userBookedDateKeys.has(dateKey)");
    expect(homePageSource).toContain("hasUserBooking ? (");
    expect(homePageSource).toContain("data-testid={`calendar-booked-tick-${dateKey}`}");
    expect(homePageSource).toContain("data-testid={`calendar-game-count-${dateKey}`}");
    expect(homePageSource).toContain("border-emerald-400/45 bg-emerald-500/20 text-emerald-200");
    expect(homePageSource).toContain("border-emerald-700/35 bg-emerald-500 text-zinc-950");
    expect(homePageSource).toContain("{gameCount}");
  });

  it("explains calendar indicator meanings with a compact legend", () => {
    expect(homePageSource).toContain("grid grid-cols-[1rem_auto] items-center gap-1.5");
    expect(homePageSource).toContain("grid gap-1 text-[0.72rem] font-semibold text-zinc-500");
    expect(homePageSource).toContain("= Your Booking");
    expect(homePageSource).toContain("= Games on This Date");
  });

  it("explains the calendar symbols in the existing FAQ", () => {
    expect(homePageSource).toContain("What do the calendar symbols mean?");
    expect(homePageSource).toContain(
      "The green tick shows a date where you have booked a game. The number shows how many games are available on that date."
    );
    expect(homePageSource).toContain("<details key={item.question}");
  });

  it("keeps keyboard-accessible buttons for all calendar controls", () => {
    expect(homePageSource).toContain('aria-label="Show previous week"');
    expect(homePageSource).toContain("aria-pressed={showAllGames}");
    expect(homePageSource).toContain('aria-label="Show next week"');
    expect(homePageSource).toContain("aria-pressed={isSelected}");
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
