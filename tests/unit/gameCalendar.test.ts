import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  getDefaultSelectedDateKey,
  getGameLondonDateKey,
  getLondonDateKey,
  getUserBookedVisibleDateKeys,
  getWeekDateKeys,
  isCalendarCountableGame,
  sortGamesByStartsAt,
} from "@/lib/gameCalendar";

describe("game calendar helpers", () => {
  it("groups UTC kickoff timestamps by London calendar date in GMT and BST", () => {
    expect(getLondonDateKey("2026-01-15T20:30:00.000Z")).toBe("2026-01-15");
    expect(getLondonDateKey("2026-07-15T23:30:00.000Z")).toBe("2026-07-16");
  });

  it("builds seven consecutive days from a selected date", () => {
    expect(getWeekDateKeys("2026-07-27")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(addDaysToDateKey("2026-07-27", -7)).toBe("2026-07-20");
  });

  it("counts only active non-archived games with starts_at", () => {
    const now = new Date("2026-07-27T09:00:00.000Z");

    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" }, now)).toBe(true);
    expect(isCalendarCountableGame({ id: 1, status: "cancelled", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" }, now)).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "draft", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" }, now)).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "hidden", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" }, now)).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: "2026-07-20T10:00:00.000Z", starts_at: "2026-07-27T18:00:00.000Z" }, now)).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: null, starts_at: null }, now)).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: null, starts_at: "2026-07-27T09:00:00.000Z" }, now)).toBe(false);
  });

  it("selects today when today has games, otherwise the next upcoming dated game", () => {
    const now = new Date("2026-07-27T09:00:00.000Z");

    expect(getDefaultSelectedDateKey([
      { id: 1, status: "active", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" },
      { id: 2, status: "active", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" },
    ], now)).toBe("2026-07-27");

    expect(getDefaultSelectedDateKey([
      { id: 1, status: "active", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" },
      { id: 2, status: "active", archived_at: null, starts_at: null },
    ], now)).toBe("2026-07-29");
  });

  it("sorts selected cards by starts_at without mutating the original list", () => {
    const games = [
      { id: 2, starts_at: "2026-07-27T20:00:00.000Z" },
      { id: 1, starts_at: "2026-07-27T18:00:00.000Z" },
    ];

    expect(sortGamesByStartsAt(games).map((game) => game.id)).toEqual([1, 2]);
    expect(games.map((game) => game.id)).toEqual([2, 1]);
  });

  it("returns null date keys for legacy or invalid games", () => {
    expect(getGameLondonDateKey({ id: 1, status: "active", archived_at: null, starts_at: null })).toBeNull();
    expect(getLondonDateKey("not-a-date")).toBeNull();
  });

  it("shows a booking tick only for the signed-in player's visible upcoming games", () => {
    const bookedDateKeys = getUserBookedVisibleDateKeys(
      [{ game_id: 1, user_id: "player-1" }],
      [{ id: 1, status: "active", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" }],
      "player-1",
      "2026-07-27",
      new Date("2026-07-27T09:00:00.000Z")
    );

    expect(bookedDateKeys).toEqual(new Set(["2026-07-29"]));
  });

  it("hides booking ticks when the booked game is deleted or otherwise not visible", () => {
    const bookings = [
      { game_id: 1, user_id: "player-1" },
      { game_id: 2, user_id: "player-1" },
      { game_id: 3, user_id: "player-1" },
      { game_id: 4, user_id: "player-1" },
      { game_id: 5, user_id: "player-1" },
      { game_id: 6, user_id: "other-player" },
    ];
    const games = [
      { id: 2, status: "cancelled", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" },
      { id: 3, status: "active", archived_at: "2026-07-20T10:00:00.000Z", starts_at: "2026-07-29T18:00:00.000Z" },
      { id: 4, status: "hidden", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" },
      { id: 5, status: "active", archived_at: null, starts_at: "2026-07-26T18:00:00.000Z" },
      { id: 6, status: "active", archived_at: null, starts_at: "2026-07-29T18:00:00.000Z" },
    ];

    expect(getUserBookedVisibleDateKeys(bookings, games, "player-1", "2026-07-27")).toEqual(
      new Set()
    );
  });

  it("hides the booking tick once the booking is removed", () => {
    const bookedGame = {
      id: 1,
      status: "active",
      archived_at: null,
      starts_at: "2026-07-29T18:00:00.000Z",
    };

    expect(getUserBookedVisibleDateKeys([], [bookedGame], "player-1", "2026-07-27")).toEqual(
      new Set()
    );
  });

  it("keeps same-date booking ticks until the last visible booked game disappears", () => {
    const bookings = [
      { game_id: 1, user_id: "player-1" },
      { game_id: 2, user_id: "player-1" },
    ];
    const firstVisibleGame = {
      id: 1,
      status: "active",
      archived_at: null,
      starts_at: "2026-07-29T18:00:00.000Z",
    };
    const secondVisibleGame = {
      id: 2,
      status: "active",
      archived_at: null,
      starts_at: "2026-07-29T20:00:00.000Z",
    };

    expect(
      getUserBookedVisibleDateKeys(
        bookings,
        [firstVisibleGame, secondVisibleGame],
        "player-1",
        "2026-07-27",
        new Date("2026-07-27T09:00:00.000Z")
      )
    ).toEqual(new Set(["2026-07-29"]));
    expect(
      getUserBookedVisibleDateKeys(
        bookings,
        [secondVisibleGame],
        "player-1",
        "2026-07-27",
        new Date("2026-07-27T09:00:00.000Z")
      )
    ).toEqual(new Set(["2026-07-29"]));
    expect(getUserBookedVisibleDateKeys(bookings, [], "player-1", "2026-07-27")).toEqual(
      new Set()
    );
  });
});
