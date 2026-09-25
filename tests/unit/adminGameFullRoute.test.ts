import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const sendGameFullEmailsMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/email/gameFull", () => ({
  sendGameFullEmails: sendGameFullEmailsMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: supabaseFromMock },
}));

import { POST } from "@/app/api/admin/emails/game-full/route";

type GameState = {
  game: { id: number; status: string; archived_at: string | null; max_players: number } | null;
  bookingCount: number;
};

const state: GameState = {
  game: { id: 75, status: "active", archived_at: null, max_players: 16 },
  bookingCount: 16,
};

class Query {
  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle() {
    return { data: this.table === "games" ? state.game : null, error: null };
  }

  then(resolve: (value: unknown) => void) {
    resolve({ count: this.table === "bookings" ? state.bookingCount : 0, error: null });
  }
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/emails/game-full", {
    method: "POST",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.game = { id: 75, status: "active", archived_at: null, max_players: 16 };
  state.bookingCount = 16;
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  sendGameFullEmailsMock.mockResolvedValue({ skipped: false, sentCount: 16 });
  supabaseFromMock.mockImplementation((table: string) => new Query(table));
});

describe("admin Game On catch-up route", () => {
  it("rejects non-admin callers without querying or sending", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await POST(request({ gameId: 75 }));

    expect(response.status).toBe(401);
    expect(supabaseFromMock).not.toHaveBeenCalled();
    expect(sendGameFullEmailsMock).not.toHaveBeenCalled();
  });

  it("rejects a game that is not full", async () => {
    state.bookingCount = 15;

    const response = await POST(request({ gameId: 75 }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ success: false, error: "Game is not full." });
    expect(sendGameFullEmailsMock).not.toHaveBeenCalled();
  });

  it("accepts only a full active game and invokes the existing sender", async () => {
    const response = await POST(request({ gameId: 75 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      gameId: 75,
      activeBookingCount: 16,
      maxPlayers: 16,
      skipped: false,
      sentCount: 16,
    });
    expect(sendGameFullEmailsMock).toHaveBeenCalledWith({ gameId: 75 });
    expect(body).not.toHaveProperty("recipients");
    expect(body).not.toHaveProperty("email");
  });

  it("keeps replay behavior delegated to the idempotent sender", async () => {
    sendGameFullEmailsMock
      .mockResolvedValueOnce({ skipped: false, sentCount: 16 })
      .mockResolvedValueOnce({ skipped: false, sentCount: 0 });

    const first = await POST(request({ gameId: 75 }));
    const second = await POST(request({ gameId: 75 }));

    expect((await first.json()).sentCount).toBe(16);
    expect((await second.json()).sentCount).toBe(0);
    expect(sendGameFullEmailsMock).toHaveBeenCalledTimes(2);
  });

  it("rejects extra payload fields", async () => {
    const response = await POST(request({ gameId: 75, admin: true }));

    expect(response.status).toBe(400);
    expect(sendGameFullEmailsMock).not.toHaveBeenCalled();
  });
});
