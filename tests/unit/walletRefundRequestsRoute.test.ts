import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const getWalletBalanceBreakdownMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/wallet", () => ({
  getWalletBalanceBreakdown: getWalletBalanceBreakdownMock,
}));

import { POST } from "@/app/api/wallet/refund-requests/route";

const state: {
  balanceBreakdown: {
    completedBalance: number;
    reservedRefundAmount: number;
    availableBalance: number;
  };
  sourceCredit: Record<string, unknown> | null;
  existingPendingRequest: { id: number } | null;
  insertedRows: Array<Record<string, unknown>>;
  insertError: { code?: string; message: string } | null;
} = {
  balanceBreakdown: {
    completedBalance: 0,
    reservedRefundAmount: 0,
    availableBalance: 0,
  },
  sourceCredit: null,
  existingPendingRequest: null,
  insertedRows: [],
  insertError: null,
};

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  private inFilters: Array<{ field: string; values: unknown[] }> = [];
  private insertPayload: Record<string, unknown> | null = null;

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  in(field: string, values: unknown[]) {
    this.inFilters.push({ field, values });
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.insertPayload = payload;
    return this;
  }

  async maybeSingle<T>() {
    const idFilter = this.filters.find((filter) => filter.field === "id");
    const transactionTypeFilter = this.filters.find((filter) => filter.field === "transaction_type");

    if (idFilter && transactionTypeFilter?.value !== "refund_requested") {
      const matchesSourceCredit = state.sourceCredit?.id === idFilter.value;

      return {
        data: (matchesSourceCredit ? state.sourceCredit : null) as T | null,
        error: null,
      };
    }

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

function refundRequest(sourceWalletTransactionId: number | null = 900) {
  return new Request("http://localhost/api/wallet/refund-requests", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source_wallet_transaction_id: sourceWalletTransactionId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.balanceBreakdown = {
    completedBalance: 12,
    reservedRefundAmount: 0,
    availableBalance: 12,
  };
  state.sourceCredit = {
    id: 900,
    user_id: "user-1",
    amount: 8,
    currency: "GBP",
    transaction_type: "game_cancelled_credit",
    status: "completed",
    game_id: 10,
    booking_id: 100,
    payment_id: 200,
    metadata: {
      original_payment_method: "sumup",
    },
  };
  state.existingPendingRequest = null;
  state.insertedRows = [];
  state.insertError = null;
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email: "player@example.com",
  });
  getWalletBalanceBreakdownMock.mockImplementation(() => Promise.resolve(state.balanceBreakdown));
  supabaseFromMock.mockImplementation(() => new MockSupabaseQuery());
});

describe("wallet refund request route", () => {
  it("returns 401 when the user is signed out", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects a refund request over the available wallet balance", async () => {
    state.balanceBreakdown = {
      completedBalance: 12,
      reservedRefundAmount: 5,
      availableBalance: 7,
    };

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Refund amount cannot be greater than your wallet balance.");
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects a duplicate pending refund request", async () => {
    state.existingPendingRequest = { id: 55 };

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "A refund has already been requested for this wallet credit.",
      refund_request_id: 55,
    });
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects a wallet-origin cancellation credit", async () => {
    state.sourceCredit = {
      ...(state.sourceCredit ?? {}),
      payment_id: null,
      metadata: {
        original_payment_method: "wallet",
      },
    };

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only SumUp cancellation credits can be requested for card refund.");
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects non-cancellation credits", async () => {
    state.sourceCredit = {
      ...(state.sourceCredit ?? {}),
      transaction_type: "admin_credit",
    };

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only SumUp cancellation credits can be requested for card refund.");
    expect(state.insertedRows).toHaveLength(0);
  });

  it("rejects credits not owned by the signed-in user", async () => {
    state.sourceCredit = {
      ...(state.sourceCredit ?? {}),
      user_id: "other-user",
    };

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Refundable wallet credit not found.");
    expect(state.insertedRows).toHaveLength(0);
  });

  it("creates a source-linked pending refund_requested transaction using available balance", async () => {
    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.balance).toBe(12);
    expect(body.balance_breakdown).toEqual({
      completedBalance: 12,
      reservedRefundAmount: 0,
      availableBalance: 12,
    });
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
        source_wallet_transaction_id: 900,
        source_transaction_type: "game_cancelled_credit",
        original_payment_method: "sumup",
        original_payment_id: 200,
        original_game_id: 10,
        original_booking_id: 100,
        refund_mode: "source_credit",
        automatic_refund_eligible: true,
      },
    });
    expect(getWalletBalanceBreakdownMock).toHaveBeenCalledWith({
      userId: "user-1",
      currency: "GBP",
    });
  });
});
