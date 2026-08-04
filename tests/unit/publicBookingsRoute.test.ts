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

import { GET } from "@/app/api/bookings/route";

type BookingRow = {
  id: number;
  game_id: number;
  player_name: string;
  user_id: string | null;
};

const state: {
  bookings: BookingRow[];
} = {
  bookings: [],
};

class MockSupabaseQuery {
  constructor(private table: string) {}

  select() {
    return this;
  }

  order() {
    return this;
  }

  then<TResult1 = { data: BookingRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: BookingRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (this.table !== "bookings") {
      throw new Error(`Unexpected table ${this.table}`);
    }

    return Promise.resolve({ data: state.bookings, error: null }).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: "user-1",
      },
    },
    error: null,
  });
  state.bookings = [
    {
      id: 100,
      game_id: 10,
      player_name: "Current Player",
      user_id: "user-1",
    },
    {
      id: 101,
      game_id: 10,
      player_name: "Other Player",
      user_id: "user-2",
    },
  ];
});

describe("public bookings route", () => {
  it("does not expose raw booking user ids or avatars", async () => {
    const response = await GET(
      new Request("http://localhost/api/bookings", {
        headers: {
          Authorization: "Bearer token",
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookings).toEqual([
      {
        id: 100,
        game_id: 10,
        player_name: "Current Player",
        is_current_user: true,
      },
      {
        id: 101,
        game_id: 10,
        player_name: "Other Player",
        is_current_user: false,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("user-2");
    expect(JSON.stringify(body)).not.toContain("avatar_url");
  });

  it("marks every booking as not current user for signed-out requests", async () => {
    const response = await GET(new Request("http://localhost/api/bookings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookings).toEqual([
      expect.objectContaining({ id: 100, is_current_user: false }),
      expect.objectContaining({ id: 101, is_current_user: false }),
    ]);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
