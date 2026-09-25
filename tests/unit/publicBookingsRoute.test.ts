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
  age: string | null;
  gender: string | null;
  avatar_url: string | null;
  favourite_position: string | null;
  left_foot_rating?: number | null;
  right_foot_rating?: number | null;
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
    {
      id: 103,
      game_id: 20,
      player_name: "Player Without Profile Details",
      user_id: "user-4",
    },
  ];
  state.profiles = [
    { id: "user-1", age: "28", gender: "Female", avatar_url: "https://example.com/current-player.jpg", favourite_position: "Midfielder", left_foot_rating: 3, right_foot_rating: 5 },
    { id: "user-2", age: "31", gender: "Male", avatar_url: null, favourite_position: "Defender", left_foot_rating: null, right_foot_rating: 4 },
    { id: "user-3", age: null, gender: null, avatar_url: "https://example.com/different-game.jpg", favourite_position: "Forward" },
    { id: "user-4", age: null, gender: null, avatar_url: null, favourite_position: null },
  ];
});

describe("public bookings route", () => {
  it("exposes roster-safe profile details to any authenticated game viewer", async () => {
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
        player_details: {
          display_name: "Current Player",
          avatar_url: "https://example.com/current-player.jpg",
          age: 28,
          gender: "Female",
          primary_position: "Midfielder",
          secondary_position: null,
          left_foot_rating: 3,
          right_foot_rating: 5,
          accelerate_type: null,
        },
      },
      {
        id: 101,
        game_id: 10,
        player_name: "Other Player",
        is_current_user: false,
        avatar_url: null,
        favourite_position: "Defender",
        player_details: {
          display_name: "Other Player",
          avatar_url: null,
          age: 31,
          gender: "Male",
          primary_position: "Defender",
          secondary_position: null,
          left_foot_rating: null,
          right_foot_rating: 4,
          accelerate_type: null,
        },
      },
      {
        id: 102,
        game_id: 20,
        player_name: "Different Game Player",
        is_current_user: false,
        avatar_url: "https://example.com/different-game.jpg",
        favourite_position: "Forward",
        player_details: {
          display_name: "Different Game Player",
          avatar_url: "https://example.com/different-game.jpg",
          primary_position: "Forward",
          secondary_position: null,
          left_foot_rating: null,
          right_foot_rating: null,
          accelerate_type: null,
        },
      },
      {
        id: 103,
        game_id: 20,
        player_name: "Player Without Profile Details",
        is_current_user: false,
        avatar_url: null,
        favourite_position: null,
        player_details: {
          display_name: "Player Without Profile Details",
          avatar_url: null,
          primary_position: null,
          secondary_position: null,
          left_foot_rating: null,
          right_foot_rating: null,
          accelerate_type: null,
        },
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("user-2");
    expect(JSON.stringify(body)).not.toContain("user-3");
    expect(JSON.stringify(body)).not.toContain("user-4");
    expect(JSON.stringify(body)).not.toContain("email");
    expect(JSON.stringify(body)).not.toContain("phone");
    expect(JSON.stringify(body)).not.toContain("date_of_birth");
  });

  it("marks every booking as not current user for signed-out requests", async () => {
    const response = await GET(new Request("http://localhost/api/bookings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookings).toEqual([
      expect.objectContaining({ id: 100, is_current_user: false }),
      expect.objectContaining({ id: 101, is_current_user: false }),
      expect.objectContaining({ id: 102, is_current_user: false }),
      expect.objectContaining({ id: 103, is_current_user: false }),
    ]);
    expect(JSON.stringify(body)).not.toContain("avatar_url");
    expect(JSON.stringify(body)).not.toContain("favourite_position");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("exposes only safe roster fields to an authenticated player who has not booked a game", async () => {
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
    expect(body.bookings).toEqual([
      expect.objectContaining({
        id: 100,
        avatar_url: "https://example.com/current-player.jpg",
        favourite_position: "Midfielder",
      }),
      expect.objectContaining({
        id: 101,
        avatar_url: null,
        favourite_position: "Defender",
      }),
      expect.objectContaining({
        id: 102,
        avatar_url: "https://example.com/different-game.jpg",
        favourite_position: "Forward",
      }),
      expect.objectContaining({
        id: 103,
        avatar_url: null,
        favourite_position: null,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("user-2");
    expect(JSON.stringify(body)).not.toContain("user-3");
    expect(JSON.stringify(body)).not.toContain("user-4");
    expect(JSON.stringify(body)).not.toContain("email");
    expect(JSON.stringify(body)).not.toContain("phone");
    expect(supabaseFromMock).toHaveBeenCalledWith("profiles");
  });
});
