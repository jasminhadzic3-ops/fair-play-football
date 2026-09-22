import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc: rpcMock },
}));

import { POST } from "@/app/api/admin/attendance/route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/attendance", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  rpcMock.mockReturnValue({
    single: async () => ({
      data: {
        booking_id: 10,
        game_id: 2,
        user_id: "player-1",
        status: "attended",
        marked_by: "admin-1",
        marked_at: "2026-09-22T12:00:00.000Z",
        updated_at: "2026-09-22T12:00:00.000Z",
        correction_note: null,
      },
      error: null,
    }),
  });
});

describe("admin attendance route", () => {
  it("requires an authenticated admin", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await POST(request({ booking_id: 10, status: "attended" }));

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects invalid attendance statuses", async () => {
    const response = await POST(request({ booking_id: 10, status: "late" }));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("writes attendance using the server-authenticated admin id", async () => {
    const response = await POST(
      request({ booking_id: 10, status: "attended", correction_reason: "Confirmed from organiser sheet" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attendance.status).toBe("attended");
    expect(rpcMock).toHaveBeenCalledWith("admin_set_booking_attendance", {
      p_booking_id: 10,
      p_status: "attended",
      p_marked_by: "admin-1",
      p_correction_reason: "Confirmed from organiser sheet",
    });
  });
});
