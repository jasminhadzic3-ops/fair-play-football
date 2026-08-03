import { describe, expect, it } from "vitest";
import { getBookingActionLifecycleBlock } from "@/lib/bookingActionLifecycle";

const now = new Date("2026-08-03T12:00:00.000Z");

const activeUpcomingGame = {
  status: "active",
  starts_at: "2026-08-03T20:00:00.000Z",
  archived_at: null,
};

describe("booking action lifecycle guard", () => {
  it("allows active upcoming games", () => {
    expect(getBookingActionLifecycleBlock(activeUpcomingGame, now)).toBeNull();
  });

  it.each([
    [null, "source_game_not_found"],
    [{ ...activeUpcomingGame, status: "draft" }, "source_game_not_active"],
    [{ ...activeUpcomingGame, starts_at: null }, "source_game_missing_starts_at"],
    [{ ...activeUpcomingGame, starts_at: "2026-08-03T12:00:00.000Z" }, "source_game_completed"],
    [{ ...activeUpcomingGame, status: "cancelled" }, "source_game_cancelled"],
    [
      { ...activeUpcomingGame, archived_at: "2026-08-03T10:00:00.000Z" },
      "source_game_archived",
    ],
  ])("blocks %s with %s", (game, reason) => {
    expect(getBookingActionLifecycleBlock(game, now)?.reason).toBe(reason);
  });
});
