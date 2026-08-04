import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendWaitingListSpotAvailableEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/waitingListSpotAvailable", () => ({
  sendWaitingListSpotAvailableEmail: sendWaitingListSpotAvailableEmailMock,
}));

import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

type WaitingListRow = {
  id: number;
  game_id: number;
  user_id: string;
  player_name: string;
  status: string;
};

const state: {
  game: {
    id: number;
    status: string;
    starts_at: string | null;
    archived_at: string | null;
    max_players: number;
  } | null;
  bookingCount: number;
  waitingRows: WaitingListRow[];
  insertedNotifications: Array<Record<string, unknown>>;
} = {
  game: null,
  bookingCount: 0,
  waitingRows: [],
  insertedNotifications: [],
};

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  private insertPayload: Record<string, unknown> | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.insertPayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  order() {
    return this;
  }

  async maybeSingle<T>() {
    if (this.table === "games") {
      return { data: state.game as T | null, error: null };
    }

    return { data: null, error: null };
  }

  async single<T>() {
    if (this.table !== "waiting_list_notifications" || !this.insertPayload) {
      throw new Error(`Unexpected single() call for ${this.table}`);
    }

    state.insertedNotifications.push(this.insertPayload);

    return {
      data: { id: 900 + state.insertedNotifications.length } as T,
      error: null,
    };
  }

  then<TResult1 = { data?: WaitingListRow[]; count?: number; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data?: WaitingListRow[]; count?: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (this.table === "bookings") {
      return Promise.resolve({ count: state.bookingCount, error: null }).then(onfulfilled, onrejected);
    }

    const data = state.waitingRows.filter((row) =>
      this.filters.every((filter) => (row as Record<string, unknown>)[filter.field] === filter.value)
    );

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendWaitingListSpotAvailableEmailMock.mockResolvedValue({ id: "email-1" });
  state.game = {
    id: 10,
    status: "active",
    starts_at: "2099-08-03T20:00:00.000Z",
    archived_at: null,
    max_players: 10,
  };
  state.bookingCount = 9;
  state.waitingRows = [
    {
      id: 800,
      game_id: 10,
      user_id: "user-1",
      player_name: "Waiting Player",
      status: "waiting",
    },
  ];
  state.insertedNotifications = [];
});

describe("notifyWaitingListForOpenSpace", () => {
  it("creates a notification and sends the waiting-list spot email to the same user", async () => {
    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 1 });
    expect(state.insertedNotifications).toHaveLength(1);
    expect(state.insertedNotifications[0]).toMatchObject({
      waiting_list_id: 800,
      game_id: 10,
      user_id: "user-1",
      player_name: "Waiting Player",
      status: "unread",
    });
    expect(sendWaitingListSpotAvailableEmailMock).toHaveBeenCalledWith({
      notificationId: 901,
      waitingListId: 800,
      userId: "user-1",
      gameId: 10,
      playerName: "Waiting Player",
    });
  });

  it("does not break notification flow when the waiting-list email fails", async () => {
    sendWaitingListSpotAvailableEmailMock.mockRejectedValue(new Error("email failed"));

    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 1 });
    expect(state.insertedNotifications).toHaveLength(1);
    expect(sendWaitingListSpotAvailableEmailMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "completed",
      { id: 10, status: "active", starts_at: "2020-08-03T20:00:00.000Z", archived_at: null, max_players: 10 },
    ],
    [
      "cancelled",
      { id: 10, status: "cancelled", starts_at: "2099-08-03T20:00:00.000Z", archived_at: null, max_players: 10 },
    ],
    [
      "archived",
      {
        id: 10,
        status: "active",
        starts_at: "2099-08-03T20:00:00.000Z",
        archived_at: "2099-08-04T10:00:00.000Z",
        max_players: 10,
      },
    ],
    [
      "inactive",
      { id: 10, status: "draft", starts_at: "2099-08-03T20:00:00.000Z", archived_at: null, max_players: 10 },
    ],
    [
      "missing kickoff",
      { id: 10, status: "active", starts_at: null, archived_at: null, max_players: 10 },
    ],
  ])("does not notify waiting-list players for %s games", async (_label, game) => {
    state.game = game;

    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 0 });
    expect(state.insertedNotifications).toHaveLength(0);
    expect(sendWaitingListSpotAvailableEmailMock).not.toHaveBeenCalled();
  });

  it("does not notify waiting-list players while the game is still full", async () => {
    state.bookingCount = 10;

    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 0 });
    expect(state.insertedNotifications).toHaveLength(0);
    expect(sendWaitingListSpotAvailableEmailMock).not.toHaveBeenCalled();
  });
});
