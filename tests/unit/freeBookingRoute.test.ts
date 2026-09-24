import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const runPostBookingActionsMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({ getAuthenticatedUser: getAuthenticatedUserMock }));
vi.mock("@/lib/postBookingActions", () => ({ runPostBookingActions: runPostBookingActionsMock }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: rpcMock, from: fromMock } }));

import { POST } from "@/app/api/free-bookings/route";

function request() {
  return new Request("http://localhost/api/free-bookings", {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: 10 }),
  }) as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({ id: "player-1", email: "player@example.com", email_confirmed_at: "2026-01-01" });
  fromMock.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: "Player", email: null }, error: null }) }) }) });
});

describe("free booking route", () => {
  it("creates a normal free booking through the server-only RPC and sends normal confirmation actions", async () => {
    rpcMock.mockResolvedValue({ data: [{ success: true, booking_id: 12, created: true, reason: null }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("create_free_booking_if_space", { p_user_id: "player-1", p_game_id: 10, p_player_name: "Player" });
    expect(runPostBookingActionsMock).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 12, bookingConfirmation: expect.objectContaining({ paymentMethod: "free", amount: 0 }) }));
  });

  it("treats an existing booking as an idempotent success without duplicate post-booking actions", async () => {
    rpcMock.mockResolvedValue({ data: [{ success: true, booking_id: 12, created: false, reason: null }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
  });

  it("does not accept a client-supplied price or payment mode", async () => {
    rpcMock.mockResolvedValue({ data: [{ success: false, booking_id: null, created: false, reason: "game_not_free" }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_amount");
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("pricing_mode");
  });
});
