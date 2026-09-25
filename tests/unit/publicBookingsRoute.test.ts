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

type ProfileRow = {
  id: string;
  avatar_url: string | null;
  favourite_position: string | null;
};

const state: {
  bookings: BookingRow[];
  profiles: ProfileRow[];
} = {
  bookings: [],
  profiles: [],
};

class MockSupabaseQuery {
  constructor(private table: string) {}

  select() {
    return this;
  }

  order() {
    return this;
  }

  in() {
    return this;
  }

  then<TResult1 = { data: BookingRow[] | ProfileRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: BookingRow[] | ProfileRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    const data = this.table === "bookings"
      ? state.bookings
      : this.table === "profiles"
        ? state.profiles
        : null;

    if (!data) throw new Error(`Unexpected table ${this.table}`);

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
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
    {
      id: 102,
      game_id: 20,
      player_name: "Different Game Player",
      user_id: "user-3",
    },
  ];
  state.profiles = [
    { id: "user-1", avatar_url: "https://example.com/current-player.jpg", favourite_position: "Midfielder" },
    { id: "user-2", avatar_url: null, favourite_position: "Defender" },
    { id: "user-3", avatar_url: "https://example.com/different-game.jpg", favourite_position: "Forward" },
  ];
});

describe("public bookings route", () => {
  it("exposes roster-safe profile details only for games the authenticated player joined", async () => {
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
        avatar_url: "https://example.com/current-player.jpg",
        favourite_position: "Midfielder",
      },
      {
        id: 101,
        game_id: 10,
        player_name: "Other Player",
        is_current_user: false,
        avatar_url: null,
        favourite_position: "Defender",
      },
      {
        id: 102,
        game_id: 20,
        player_name: "Different Game Player",
        is_current_user: false,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("user-2");
    expect(JSON.stringify(body)).not.toContain("different-game.jpg");
    expect(JSON.stringify(body)).not.toContain("Forward");
  });

  it("marks every booking as not current user for signed-out requests", async () => {
    const response = await GET(new Request("http://localhost/api/bookings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookings).toEqual([
      expect.objectContaining({ id: 100, is_current_user: false }),
      expect.objectContaining({ id: 101, is_current_user: false }),
      expect.objectContaining({ id: 102, is_current_user: false }),
    ]);
    expect(JSON.stringify(body)).not.toContain("avatar_url");
    expect(JSON.stringify(body)).not.toContain("favourite_position");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("does not expose profile details to an authenticated player outside the game", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "spectator-user" } },
      error: null,
    });

    const response = await GET(
      new Request("http://localhost/api/bookings", {
        headers: { Authorization: "Bearer spectator-token" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("avatar_url");
    expect(JSON.stringify(body)).not.toContain("favourite_position");
    expect(supabaseFromMock).not.toHaveBeenCalledWith("profiles");
  });
});
