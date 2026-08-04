import { beforeEach, describe, expect, it, vi } from "vitest";

const assertSupabaseAdminConfiguredMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: assertSupabaseAdminConfiguredMock,
  supabaseAdmin: {
    auth: {
      getUser: getUserMock,
    },
    from: supabaseFromMock,
  },
}));

import { POST } from "@/app/api/waiting-list/route";

type GameRow = {
  id: number;
  max_players: number;
  status: string;
  starts_at: string | null;
  archived_at: string | null;
};

type WaitingListRow = {
  id: number;
  game_id: number;
  user_id: string;
  player_name: string;
  status: string;
  created_at?: string;
};

const state: {
  game: GameRow | null;
  bookingCount: number;
  existingBooking: { id: number } | null;
  existingWaitingListRow: WaitingListRow | null;
  insertedWaitingListRow: WaitingListRow | null;
} = {
  game: null,
  bookingCount: 0,
  existingBooking: null,
  existingWaitingListRow: null,
  insertedWaitingListRow: null,
};

class MockSupabaseQuery {
  private filters: Record<string, unknown> = {};
  private countMode = false;
  private insertPayload: Record<string, unknown> | null = null;

  constructor(private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.countMode = Boolean(options?.count);
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.insertPayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters[field] = value;
    return this;
  }

  async maybeSingle<T>() {
    if (this.table === "games") {
      return { data: state.game as T | null, error: null };
    }

    if (this.table === "bookings") {
      return { data: state.existingBooking as T | null, error: null };
    }

    if (this.table === "waiting_list") {
      return { data: state.existingWaitingListRow as T | null, error: null };
    }

    return { data: null, error: null };
  }

  async single<T>() {
    if (this.table !== "waiting_list" || !this.insertPayload) {
      throw new Error(`Unexpected single() call for ${this.table}`);
    }

    state.insertedWaitingListRow = {
      id: 900,
      game_id: Number(this.insertPayload.game_id),
      user_id: String(this.insertPayload.user_id),
      player_name: String(this.insertPayload.player_name),
      status: "waiting",
      created_at: "2099-08-03T20:00:00.000Z",
    };

    return { data: state.insertedWaitingListRow as T, error: null };
  }

  then<TResult1 = { count?: number; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { count?: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (this.countMode && this.table === "bookings") {
      return Promise.resolve({ count: state.bookingCount, error: null }).then(onfulfilled, onrejected);
    }

    return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
  }
}

function request(gameId = 10) {
  return new Request("http://localhost/api/waiting-list", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      game_id: gameId,
      player_name: "Waiting Player",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: "user-1",
        email_confirmed_at: "2026-07-01T10:00:00.000Z",
      },
    },
    error: null,
  });
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  state.game = {
    id: 10,
    max_players: 10,
    status: "active",
    starts_at: "2099-08-03T20:00:00.000Z",
    archived_at: null,
  };
  state.bookingCount = 10;
  state.existingBooking = null;
  state.existingWaitingListRow = null;
  state.insertedWaitingListRow = null;
});

describe("waiting list route", () => {
  it("allows joining the waiting list for a full active upcoming game", async () => {
    const response = await POST(request() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.waiting_list_entry).toMatchObject({
      game_id: 10,
      user_id: "user-1",
      player_name: "Waiting Player",
    });
  });

  it("keeps the existing not-full message for active bookable games", async () => {
    state.bookingCount = 9;

    const response = await POST(request() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("This game still has spaces. Please book normally.");
    expect(state.insertedWaitingListRow).toBeNull();
  });

  it.each([
    [
      "completed",
      { id: 10, max_players: 10, status: "active", starts_at: "2020-08-03T20:00:00.000Z", archived_at: null },
      "This game is no longer available for booking.",
    ],
    [
      "cancelled",
      {
        id: 10,
        max_players: 10,
        status: "cancelled",
        starts_at: "2099-08-03T20:00:00.000Z",
        archived_at: null,
      },
      "This game has been cancelled and is no longer available for booking.",
    ],
    [
      "archived",
      {
        id: 10,
        max_players: 10,
        status: "active",
        starts_at: "2099-08-03T20:00:00.000Z",
        archived_at: "2099-08-04T10:00:00.000Z",
      },
      "This game has been archived and is no longer available for booking.",
    ],
    [
      "inactive",
      { id: 10, max_players: 10, status: "draft", starts_at: "2099-08-03T20:00:00.000Z", archived_at: null },
      "This game is no longer available for booking.",
    ],
    [
      "missing kickoff",
      { id: 10, max_players: 10, status: "active", starts_at: null, archived_at: null },
      "This game is no longer available for booking.",
    ],
  ])("rejects %s games", async (_label, game, expectedError) => {
    state.game = game;

    const response = await POST(request() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe(expectedError);
    expect(state.insertedWaitingListRow).toBeNull();
  });
});
