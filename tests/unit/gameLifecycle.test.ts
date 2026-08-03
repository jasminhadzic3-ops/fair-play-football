import { describe, expect, it } from "vitest";
import {
  canAdminCancel,
  canArchive,
  canJoinWaitingList,
  canPlayerLeave,
  getGameLifecycle,
  isArchived,
  isBookable,
  isCancelled,
  isCompleted,
  isPubliclyVisible,
  type GameLifecycle,
} from "@/lib/gameLifecycle";

const now = new Date("2026-08-03T12:00:00.000Z");

const futureGame = {
  status: "active",
  starts_at: "2026-08-03T20:00:00.000Z",
  archived_at: null,
  max_players: 12,
};

function expectLifecycleActions(
  lifecycle: GameLifecycle,
  expected: {
    adminCancel: boolean;
    archive: boolean;
    bookable: boolean;
    joinWaitingList: boolean;
    playerLeave: boolean;
    publiclyVisible: boolean;
  }
) {
  const game =
    lifecycle === "draft"
      ? { ...futureGame, status: "draft" }
      : lifecycle === "active_bookable"
        ? futureGame
        : lifecycle === "full"
          ? futureGame
          : lifecycle === "completed"
            ? { ...futureGame, starts_at: "2026-08-03T11:59:59.000Z" }
            : lifecycle === "cancelled"
              ? { ...futureGame, status: "cancelled" }
              : { ...futureGame, archived_at: "2026-08-03T10:00:00.000Z" };
  const context = lifecycle === "full" ? { bookingCount: 12, now } : { bookingCount: 0, now };

  expect(canAdminCancel(game, context)).toBe(expected.adminCancel);
  expect(canArchive(game, context)).toBe(expected.archive);
  expect(isBookable(game, context)).toBe(expected.bookable);
  expect(canJoinWaitingList(game, context)).toBe(expected.joinWaitingList);
  expect(canPlayerLeave(game, context)).toBe(expected.playerLeave);
  expect(isPubliclyVisible(game, context)).toBe(expected.publiclyVisible);
}

describe("canonical game lifecycle", () => {
  it("classifies draft games", () => {
    expect(getGameLifecycle({ ...futureGame, status: "draft" }, { now })).toBe("draft");
  });

  it("classifies active future games with available spaces as active bookable", () => {
    expect(getGameLifecycle(futureGame, { bookingCount: 11, now })).toBe("active_bookable");
  });

  it("classifies active future games at capacity as full", () => {
    expect(getGameLifecycle(futureGame, { bookingCount: 12, now })).toBe("full");
  });

  it("classifies active games at or after kickoff as completed", () => {
    expect(
      getGameLifecycle({ ...futureGame, starts_at: now.toISOString() }, { bookingCount: 12, now })
    ).toBe("completed");
    expect(
      getGameLifecycle(
        { ...futureGame, starts_at: "2026-08-03T12:00:01.000Z" },
        { bookingCount: 12, now }
      )
    ).toBe("full");
    expect(
      getGameLifecycle(
        { ...futureGame, starts_at: "2026-08-03T11:59:59.000Z" },
        { bookingCount: 0, now }
      )
    ).toBe("completed");
  });

  it("classifies cancelled games", () => {
    expect(getGameLifecycle({ ...futureGame, status: "cancelled" }, { bookingCount: 12, now })).toBe(
      "cancelled"
    );
  });

  it("classifies archived games", () => {
    expect(
      getGameLifecycle(
        { ...futureGame, status: "cancelled", archived_at: "2026-08-03T10:00:00.000Z" },
        { now }
      )
    ).toBe("archived");
  });

  it("treats archived as the highest-priority override", () => {
    expect(
      getGameLifecycle(
        { ...futureGame, status: "draft", archived_at: "2026-08-03T10:00:00.000Z" },
        { now }
      )
    ).toBe("archived");
    expect(
      getGameLifecycle(
        { ...futureGame, status: "active", archived_at: "2026-08-03T10:00:00.000Z" },
        { bookingCount: 0, now }
      )
    ).toBe("archived");
  });

  it("treats cancelled as an override before full or completed", () => {
    expect(
      getGameLifecycle(
        { ...futureGame, status: "cancelled", starts_at: "2026-08-03T11:59:59.000Z" },
        { bookingCount: 12, now }
      )
    ).toBe("cancelled");
  });

  it("treats full as an override before bookable for future active games", () => {
    expect(getGameLifecycle(futureGame, { bookingCount: 12, now })).toBe("full");
    expect(getGameLifecycle(futureGame, { bookingCount: 13, now })).toBe("full");
    expect(getGameLifecycle(futureGame, { bookingCount: 11, now })).toBe("active_bookable");
  });

  it("treats games with missing or invalid starts_at as draft", () => {
    expect(getGameLifecycle({ ...futureGame, starts_at: null }, { now })).toBe("draft");
    expect(getGameLifecycle({ ...futureGame, starts_at: "not-a-date" }, { now })).toBe("draft");
  });

  it("exposes boolean helpers for each lifecycle", () => {
    expect(isArchived({ ...futureGame, archived_at: "2026-08-03T10:00:00.000Z" }, { now })).toBe(
      true
    );
    expect(isCancelled({ ...futureGame, status: "cancelled" }, { now })).toBe(true);
    expect(isCompleted({ ...futureGame, starts_at: "2026-08-03T11:59:59.000Z" }, { now })).toBe(
      true
    );
  });

  it("defines actions for draft games", () => {
    expectLifecycleActions("draft", {
      adminCancel: false,
      archive: false,
      bookable: false,
      joinWaitingList: false,
      playerLeave: false,
      publiclyVisible: false,
    });
  });

  it("defines actions for active bookable games", () => {
    expectLifecycleActions("active_bookable", {
      adminCancel: true,
      archive: false,
      bookable: true,
      joinWaitingList: false,
      playerLeave: true,
      publiclyVisible: true,
    });
  });

  it("defines actions for full games", () => {
    expectLifecycleActions("full", {
      adminCancel: true,
      archive: false,
      bookable: false,
      joinWaitingList: true,
      playerLeave: true,
      publiclyVisible: true,
    });
  });

  it("defines actions for completed games", () => {
    expectLifecycleActions("completed", {
      adminCancel: false,
      archive: true,
      bookable: false,
      joinWaitingList: false,
      playerLeave: false,
      publiclyVisible: false,
    });
  });

  it("defines actions for cancelled games", () => {
    expectLifecycleActions("cancelled", {
      adminCancel: false,
      archive: true,
      bookable: false,
      joinWaitingList: false,
      playerLeave: false,
      publiclyVisible: false,
    });
  });

  it("defines actions for archived games", () => {
    expectLifecycleActions("archived", {
      adminCancel: false,
      archive: false,
      bookable: false,
      joinWaitingList: false,
      playerLeave: false,
      publiclyVisible: false,
    });
  });
});
