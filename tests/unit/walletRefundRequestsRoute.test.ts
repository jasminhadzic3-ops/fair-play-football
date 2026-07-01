import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const supabaseRpcMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: supabaseRpcMock,
    from: supabaseFromMock,
  },
}));

import { POST } from "@/app/api/wallet/refund-requests/route";

const state: {
  balance: number;
  existingPendingRequest: { id: number } | null;
  insertedRows: Array<Record<string, unknown>>;
  insertError: { code?: string; message: string } | null;
} = {
  balance: 0,
  existingPendingRequest: null,
  insertedRows: [],
  insertError: null,
};

class MockSupabaseQuery {
  private insertPayload: Record<string, unknown> | null = null;

  select() {
    return this;
  }

  eq() {
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.insertPayload = payload;
    return this;
  }

  async maybeSingle<T>() {
    return {
      data: (state.existingPendingRequest ?? null) as T | null,
      error: null,
    };
  }

  async single<T>() {
    if (state.insertError) {
      return { data: null as T | null, error: state.insertError };
    }

    if (!this.insertPayload) {
      throw new Error("Expected refund request insert payload.");
    }

    state.insertedRows.push(this.insertPayload);

    return {
      data: {
        id: 123,
        ...this.insertPayload,
        created_at: "2026-07-01T10:00:00.000Z",
      } as T,
      error: null,
    };
  }
}

function refundRequest(amount: number) {
  return new Request("http://localhost/api/wallet/refund-requests", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.balance = 12;
  state.existingPendingRequest = null;
  state.insertedRows = [];
  state.insertError = null;
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email: "player@example.com",
  });
  supabaseRpcMock.mockResolvedValue({ data: state.balance, error: null });
  supabaseFromMock.mockImplementation(() => new MockSupabaseQuery());
});

describe("wallet refund request route", () => {
  it("returns 401 when the user is signed out", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await POST(refundRequest(8) as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects a refund request over the completed wallet balance", async () => {
    state.balance = 8;
    supabaseRpcMock.mockResolvedValue({ data: state.balance, error: null });

    const response = await POST(refundRequest(9) as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Refund amount cannot be greater than your wallet balance.");
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects a duplicate pending refund request", async () => {
    state.existingPendingRequest = { id: 55 };

    const response = await POST(refundRequest(8) as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "You already have a pending refund request.",
      refund_request_id: 55,
    });
    expect(state.insertedRows).toHaveLength(0);
  });

  it("creates a pending refund_requested transaction without reducing completed balance", async () => {
    const response = await POST(refundRequest(8) as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.balance).toBe(12);
    expect(body.refund_request).toMatchObject({
      id: 123,
      amount: -8,
      currency: "GBP",
      transaction_type: "refund_requested",
      status: "pending",
      description: "Refund requested",
    });
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      user_id: "user-1",
      amount: -8,
      currency: "GBP",
      transaction_type: "refund_requested",
      status: "pending",
      description: "Refund requested",
      metadata: {
        source: "wallet_refund_request_api",
        requested_balance: 12,
      },
    });
    expect(supabaseRpcMock).toHaveBeenCalledWith("get_wallet_balance", {
      p_user_id: "user-1",
      p_currency: "GBP",
    });
  });
});
