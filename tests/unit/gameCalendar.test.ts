import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  getDefaultSelectedDateKey,
  getGameLondonDateKey,
  getLondonDateKey,
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
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" })).toBe(true);
    expect(isCalendarCountableGame({ id: 1, status: "cancelled", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" })).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "draft", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" })).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "hidden", archived_at: null, starts_at: "2026-07-27T18:00:00.000Z" })).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: "2026-07-20T10:00:00.000Z", starts_at: "2026-07-27T18:00:00.000Z" })).toBe(false);
    expect(isCalendarCountableGame({ id: 1, status: "active", archived_at: null, starts_at: null })).toBe(false);
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
});
