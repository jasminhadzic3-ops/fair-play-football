import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const notifyWaitingListForOpenSpaceMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/waitingListNotifications", () => ({
  notifyWaitingListForOpenSpace: notifyWaitingListForOpenSpaceMock,
}));

import { DELETE } from "@/app/api/admin/bookings/[id]/route";

let bookingRow: { id: number; game_id: number } | null;
let gameRow: {
  id: number;
  max_players: number;
  status: string;
  starts_at: string | null;
  archived_at: string | null;
} | null;
let bookingCounts: number[];
let deleteCalled: boolean;

class MockSupabaseQuery {
  private mode: "select" | "delete" = "select";
  private countMode = false;

  constructor(private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.countMode = Boolean(options?.count);
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle() {
    if (this.table === "bookings") {
      return { data: bookingRow, error: null };
    }

    if (this.table === "games") {
      return { data: gameRow, error: null };
    }

    return { data: null, error: null };
  }

  then<TResult1 = { count?: number; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { count?: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (this.mode === "delete") {
      deleteCalled = true;
      return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
    }

    if (this.countMode) {
      return Promise.resolve({ count: bookingCounts.shift() ?? 0, error: null }).then(
        onfulfilled,
        onrejected
      );
    }

    return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
  }
}

function request() {
  return new Request("http://localhost/api/admin/bookings/100", {
    method: "DELETE",
    headers: {
      Authorization: "Bearer token",
    },
  });
}

async function deleteBooking(id = "100") {
  return DELETE(request() as Parameters<typeof DELETE>[0], {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bookingRow = { id: 100, game_id: 10 };
  gameRow = {
    id: 10,
    max_players: 12,
    status: "active",
    starts_at: "2099-08-03T20:00:00.000Z",
    archived_at: null,
  };
  bookingCounts = [12, 11];
  deleteCalled = false;
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  notifyWaitingListForOpenSpaceMock.mockResolvedValue({ notifiedCount: 1 });
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
});

describe("admin remove booking route", () => {
  it("removes active upcoming bookings and preserves existing waiting-list notifications", async () => {
    const response = await deleteBooking();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(deleteCalled).toBe(true);
    expect(notifyWaitingListForOpenSpaceMock).toHaveBeenCalledWith(10);
  });

  it.each([
    [
      "completed",
      { id: 10, max_players: 12, status: "active", starts_at: "2020-08-03T20:00:00.000Z", archived_at: null },
      "source_game_completed",
    ],
    [
      "cancelled",
      {
        id: 10,
        max_players: 12,
        status: "cancelled",
        starts_at: "2099-08-03T20:00:00.000Z",
        archived_at: null,
      },
      "source_game_cancelled",
    ],
    [
      "archived",
      {
        id: 10,
        max_players: 12,
        status: "active",
        starts_at: "2099-08-03T20:00:00.000Z",
        archived_at: "2099-08-04T10:00:00.000Z",
      },
      "source_game_archived",
    ],
  ])("rejects removing bookings from %s source games", async (_label, sourceGame, reason) => {
    gameRow = sourceGame;

    const response = await deleteBooking();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe(reason);
    expect(deleteCalled).toBe(false);
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });
});
