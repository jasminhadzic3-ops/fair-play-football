import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const debitWalletMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/wallet", () => ({
  debitWallet: debitWalletMock,
}));

import { PATCH } from "@/app/api/admin/refund-requests/[id]/route";

type RefundRequestRow = {
  id: number;
  user_id: string;
  amount: number | string;
  currency: string | null;
  transaction_type: string;
  status: string;
  admin_note: string | null;
  metadata: Record<string, unknown>;
};

type Filter = {
  field: string;
  value: unknown;
};

const state: {
  refundRequest: RefundRequestRow | null;
  updateCalls: Array<Record<string, unknown>>;
} = {
  refundRequest: null,
  updateCalls: [],
};

function matchesFilters(row: RefundRequestRow, filters: Filter[]) {
  return filters.every((filter) => (row as unknown as Record<string, unknown>)[filter.field] === filter.value);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];
  private updatePayload: Record<string, unknown> | null = null;

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  async maybeSingle<T>() {
    if (!state.refundRequest || !matchesFilters(state.refundRequest, this.filters)) {
      return { data: null as T | null, error: null };
    }

    if (this.updatePayload) {
      state.updateCalls.push(this.updatePayload);
      state.refundRequest = {
        ...state.refundRequest,
        ...this.updatePayload,
      } as RefundRequestRow;
    }

    return { data: state.refundRequest as T, error: null };
  }
}

function requestBody(action: "approve" | "reject", reason = "Admin note") {
  return new Request("http://localhost/api/admin/refund-requests/501", {
    method: "PATCH",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, reason }),
  });
}

function routeContext(id = "501") {
  return {
    params: Promise.resolve({ id }),
  };
}

function defaultRefundRequest(overrides: Partial<RefundRequestRow> = {}): RefundRequestRow {
  return {
    id: 501,
    user_id: "user-1",
    amount: -8,
    currency: "GBP",
    transaction_type: "refund_requested",
    status: "pending",
    admin_note: null,
    metadata: {
      source: "wallet_refund_request_api",
      requested_balance: 8,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation(() => new MockSupabaseQuery());
  debitWalletMock.mockResolvedValue({ id: 700 });
  state.refundRequest = defaultRefundRequest();
  state.updateCalls = [];
});

describe("admin refund request route", () => {
  it("blocks non-admin users", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await PATCH(
      requestBody("approve") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(401);
    expect(debitWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("rejects a pending request without changing wallet balance", async () => {
    const response = await PATCH(
      requestBody("reject", "Customer asked to cancel") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(debitWalletMock).not.toHaveBeenCalled();
    expect(state.refundRequest).toMatchObject({
      status: "cancelled",
      admin_note: "Customer asked to cancel",
    });
    expect(body.refund_request.metadata).toMatchObject({
      rejected_by: "admin-1",
      rejection_reason: "Customer asked to cancel",
    });
  });

  it("approves a pending request by creating one refund_completed debit", async () => {
    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(debitWalletMock).toHaveBeenCalledTimes(1);
    expect(debitWalletMock).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 8,
      currency: "GBP",
      transactionType: "refund_completed",
      idempotencyKey: "refund_completed:request:501",
      description: "Refund completed",
      adminNote: "Paid manually",
      metadata: {
        refund_request_id: 501,
        processed_by: "admin-1",
        manual: true,
      },
    });
  });

  it("marks the approved request completed and links the debit transaction", async () => {
    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.refundRequest).toMatchObject({
      status: "completed",
      admin_note: "Paid manually",
    });
    expect(body.refund_request.metadata).toMatchObject({
      refund_completed_transaction_id: 700,
      processed_by: "admin-1",
    });
  });

  it("does not double debit a duplicate approval after the request is completed", async () => {
    const firstResponse = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const secondResponse = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(404);
    expect(secondBody.error).toBe("Pending refund request not found.");
    expect(debitWalletMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the request pending when wallet balance is insufficient", async () => {
    debitWalletMock.mockRejectedValue(new Error("Insufficient wallet balance for this debit."));

    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Insufficient wallet balance for this debit.");
    expect(state.refundRequest).toMatchObject({
      status: "pending",
      admin_note: null,
    });
  });
});
