import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const sendNewGamePostedEmailsMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/email/newGamePosted", () => ({
  sendNewGamePostedEmails: sendNewGamePostedEmailsMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { POST } from "@/app/api/admin/games/route";
import { PATCH } from "@/app/api/admin/games/[id]/route";

type GamePayload = Record<string, unknown>;

const state: {
  insertPayload: GamePayload | null;
  updatePayload: GamePayload | null;
  selectedGame: GamePayload | null;
} = {
  insertPayload: null,
  updatePayload: null,
  selectedGame: null,
};

class MockSupabaseQuery {
  constructor(private table: string) {}

  insert(payload: GamePayload) {
    expect(this.table).toBe("games");
    state.insertPayload = payload;
    return this;
  }

  update(payload: GamePayload) {
    expect(this.table).toBe("games");
    state.updatePayload = payload;
    return this;
  }

  eq() {
    return this;
  }

  select() {
    return this;
  }

  async single<T>() {
    return {
      data: {
        id: 123,
        ...(state.selectedGame ?? {}),
        ...(state.insertPayload ?? state.updatePayload),
      } as T,
      error: null,
    };
  }
}

function adminRequest(body: unknown) {
  return new Request("http://localhost/api/admin/games", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  sendNewGamePostedEmailsMock.mockResolvedValue({ skipped: true, sentCount: 0 });
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  state.insertPayload = null;
  state.updatePayload = null;
  state.selectedGame = null;
});

describe("admin game structured kickoff handling", () => {
  it("creates new games with London-derived display time and starts_at", async () => {
    const response = await POST(
      adminRequest({
        title: "Summer Football",
        location: "London",
        kickoff_date: "2026-07-15",
        kickoff_time: "20:30",
        price: 5,
        max_players: 12,
      }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(201);
    expect(state.insertPayload).toMatchObject({
      title: "Summer Football",
      location: "London",
      time: "15 Jul 2026, 20:30",
      starts_at: "2026-07-15T19:30:00.000Z",
      price: 5,
      max_players: 12,
    });
  });

  it("rejects new games without a complete structured kickoff", async () => {
    const response = await POST(
      adminRequest({
        title: "No Kickoff",
        location: "London",
        time: "Friday 7pm",
        price: 5,
        max_players: 12,
      }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(400);
    expect(state.insertPayload).toBeNull();
  });

  it("updates games with a new structured kickoff when provided", async () => {
    const response = await PATCH(
      adminRequest({
        title: "Winter Football",
        location: "London",
        kickoff_date: "2026-01-15",
        kickoff_time: "20:30",
        price: 5,
        max_players: 12,
      }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "123" }) }
    );

    expect(response.status).toBe(200);
    expect(state.updatePayload).toMatchObject({
      time: "15 Jan 2026, 20:30",
      starts_at: "2026-01-15T20:30:00.000Z",
    });
  });

  it("keeps legacy display time when editing an old game without starts_at", async () => {
    const response = await PATCH(
      adminRequest({
        title: "Legacy Football",
        location: "London",
        time: "Friday 7pm",
        price: 5,
        max_players: 12,
      }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "123" }) }
    );

    expect(response.status).toBe(200);
    expect(state.updatePayload).toMatchObject({
      time: "Friday 7pm",
      price: 5,
      max_players: 12,
    });
    expect(state.updatePayload).not.toHaveProperty("starts_at");
  });

  it("archives only past, cancelled or legacy games with the archive fields", async () => {
    state.selectedGame = {
      id: 123,
      status: "active",
      starts_at: "2026-07-21T18:00:00.000Z",
    };

    const response = await PATCH(
      adminRequest({ action: "archive" }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "123" }) }
    );

    expect(response.status).toBe(200);
    expect(state.updatePayload).toEqual({
      archived_at: expect.any(String),
      archived_by: "admin-1",
    });
  });

  it("rejects archive for active future games without updating gameplay fields", async () => {
    state.selectedGame = {
      id: 123,
      status: "active",
      starts_at: "2999-07-21T18:00:00.000Z",
    };

    const response = await PATCH(
      adminRequest({ action: "archive" }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "123" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Active future games cannot be archived");
    expect(state.updatePayload).toBeNull();
  });

  it("unarchives by clearing only archive fields", async () => {
    state.selectedGame = {
      id: 123,
      status: "cancelled",
      starts_at: "2026-07-21T18:00:00.000Z",
    };

    const response = await PATCH(
      adminRequest({ action: "unarchive" }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: "123" }) }
    );

    expect(response.status).toBe(200);
    expect(state.updatePayload).toEqual({
      archived_at: null,
      archived_by: null,
    });
  });
});
