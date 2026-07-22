import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminPageSource = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");

describe("admin dashboard polish source", () => {
  it("loads edited games into the form, scrolls to it, and focuses the title field", () => {
    expect(adminPageSource).toContain("const formSectionRef = useRef<HTMLElement | null>(null)");
    expect(adminPageSource).toContain("const titleInputRef = useRef<HTMLInputElement | null>(null)");
    expect(adminPageSource).toContain("setEditingGameId(game.id)");
    expect(adminPageSource).toContain("scrollToElement(formSectionRef.current)");
    expect(adminPageSource).toContain("focusTitleAfterScroll()");
    expect(adminPageSource).toContain('id="admin-game-title"');
    expect(adminPageSource).toContain("ref={titleInputRef}");
    expect(adminPageSource).toContain("Editing Game");
    expect(adminPageSource).toContain("Cancel Editing");
  });

  it("respects reduced motion and uses stable game-card refs for update scrolling", () => {
    expect(adminPageSource).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)")');
    expect(adminPageSource).toContain('prefersReducedMotion() ? "auto" : "smooth"');
    expect(adminPageSource).toContain("const gameCardRefs = useRef(new Map<number, HTMLDivElement>())");
    expect(adminPageSource).toContain("setPendingScrollGameId(savedEditingGameId)");
    expect(adminPageSource).toContain("gameCardRefs.current.get(pendingScrollGameId)");
    expect(adminPageSource).toContain("highlightGameCard(pendingScrollGameId)");
  });

  it("preserves search/filter state and handles hidden updated cards safely", () => {
    const hiddenUpdatedCardBranch = adminPageSource.slice(
      adminPageSource.indexOf("if (!visibleGames.some"),
      adminPageSource.indexOf("const setGameCardRef")
    );

    expect(hiddenUpdatedCardBranch).not.toContain("setGameFilter");
    expect(hiddenUpdatedCardBranch).not.toContain("setGameSearch");
    expect(adminPageSource).toContain("It is hidden by the current search or filter.");
  });

  it("disables duplicate submits and shows create/update loading labels", () => {
    expect(adminPageSource).toContain("if (isSubmitting) return");
    expect(adminPageSource).toContain("disabled={isSubmitting}");
    expect(adminPageSource).toContain("Updating...");
    expect(adminPageSource).toContain("Creating...");
  });

  it("uses existing dashboard state for operational summary cards", () => {
    [
      "Upcoming games",
      "Archived games",
      "Current bookings",
      "Registered users",
      "Paid payments amount",
      "Refund attention",
      "Waiting list",
    ].forEach((label) => expect(adminPageSource).toContain(label));

    expect(adminPageSource).toContain("operationalSummary.upcomingGamesCount");
    expect(adminPageSource).toContain("operationalSummary.archivedGamesCount");
    expect(adminPageSource).toContain("operationalSummary.currentBookingsCount");
    expect(adminPageSource).toContain("refundRequests.length");
    expect(adminPageSource).toContain("waitingList.length");
    expect(adminPageSource).toContain('fetch("/api/admin/dashboard"');
  });

  it("keeps archive, refund, move, and delete actions available", () => {
    expect(adminPageSource).toContain('archiveGame(game, "archive")');
    expect(adminPageSource).toContain('archiveGame(game, "unarchive")');
    expect(adminPageSource).toContain("processAdminRefundCandidate(game, candidate)");
    expect(adminPageSource).toContain("moveBooking(booking, new FormData(event.currentTarget))");
    expect(adminPageSource).toContain("deleteGame(game)");
  });
});
