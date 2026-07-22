import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const notifyWaitingListForOpenSpaceMock = vi.hoisted(() => vi.fn());
const supabaseRpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: supabaseRpcMock,
  },
}));

vi.mock("@/lib/waitingListNotifications", () => ({
  notifyWaitingListForOpenSpace: notifyWaitingListForOpenSpaceMock,
}));

import { PATCH } from "@/app/api/admin/bookings/[id]/move/route";

type MoveResult = {
  success: boolean;
  booking_id: number | null;
  source_game_id: number | null;
  target_game_id: number | null;
  reason: string | null;
  source_was_full_before_move: boolean;
  source_has_space_after_move: boolean;
};

const successfulMove: MoveResult = {
  success: true,
  booking_id: 100,
  source_game_id: 1,
  target_game_id: 2,
  reason: null,
  source_was_full_before_move: false,
  source_has_space_after_move: false,
};

function mockRpcResult(result: MoveResult, error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data: result, error });
  supabaseRpcMock.mockReturnValue({ single });
}

function moveRequest(targetGameId: number) {
  return new Request("http://localhost/api/admin/bookings/100/move", {
    method: "PATCH",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_game_id: targetGameId }),
  });
}

async function moveTo(targetGameId: number) {
  return PATCH(moveRequest(targetGameId) as Parameters<typeof PATCH>[0], {
    params: Promise.resolve({ id: "100" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  notifyWaitingListForOpenSpaceMock.mockResolvedValue({ sentCount: 0 });
  mockRpcResult(successfulMove);
});

describe("admin move booking route", () => {
  it("uses the atomic move RPC instead of direct count-then-update logic", async () => {
    const response = await moveTo(2);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.booking).toEqual({ id: 100, game_id: 2 });
    expect(supabaseRpcMock).toHaveBeenCalledWith("move_booking_if_space", {
      p_booking_id: 100,
      p_target_game_id: 2,
    });
  });

  it.each([
    ["same_game", "already in the selected game"],
    ["target_game_cancelled", "cancelled"],
    ["target_game_not_active", "active games"],
    ["target_game_missing_starts_at", "structured kickoff"],
    ["target_game_past", "past games"],
    ["target_game_full", "Target game is full."],
    ["booking_has_cancellation_history", "cancellation credit history"],
    ["booking_has_refund_history", "refund history"],
    ["booking_has_ambiguous_payment_history", "ambiguous payment history"],
  ])("maps %s to a safe conflict response", async (reason, expectedMessage) => {
    mockRpcResult({
      ...successfulMove,
      success: false,
      reason,
      source_game_id: 1,
      target_game_id: 2,
    });

    const response = await moveTo(2);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe(reason);
    expect(body.error).toContain(expectedMessage);
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });

  it("maps booking_not_found to 404", async () => {
    mockRpcResult({
      ...successfulMove,
      success: false,
      booking_id: null,
      reason: "booking_not_found",
    });

    const response = await moveTo(2);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Booking not found.");
  });

  it("maps invalid RPC reason codes to 400", async () => {
    mockRpcResult({
      ...successfulMove,
      success: false,
      reason: "invalid_target_game",
    });

    const response = await moveTo(2);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid booking move request.");
  });

  it("notifies the source waiting list only when the RPC reports newly opened space", async () => {
    mockRpcResult({
      ...successfulMove,
      source_was_full_before_move: true,
      source_has_space_after_move: true,
    });

    const response = await moveTo(2);

    expect(response.status).toBe(200);
    expect(notifyWaitingListForOpenSpaceMock).toHaveBeenCalledWith(1);
  });

  it("does not notify waiting list when the source was not full", async () => {
    await moveTo(2);

    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });

  it("returns a safe server error when the RPC fails", async () => {
    mockRpcResult(successfulMove, { message: "database unavailable" });

    const response = await moveTo(2);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("database unavailable");
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });
});
