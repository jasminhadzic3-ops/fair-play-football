import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const claimSumUpRefundAttemptMock = vi.hoisted(() => vi.fn());
const completeWalletRefundRequestMock = vi.hoisted(() => vi.fn());
const refundSumUpTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/wallet", () => ({
  claimSumUpRefundAttempt: claimSumUpRefundAttemptMock,
  completeWalletRefundRequest: completeWalletRefundRequestMock,
}));

vi.mock("@/lib/sumupPayments", () => ({
  refundSumUpTransaction: refundSumUpTransactionMock,
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

function requestBody(action: "approve" | "reject" | "claim_sumup_refund", reason = "Admin note") {
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
  claimSumUpRefundAttemptMock.mockResolvedValue({
    success: true,
    attemptId: 900,
    reason: null,
    refundRequestId: 501,
    amount: 8,
    currency: "GBP",
    bookingPaymentId: 300,
    sourceWalletTransactionId: 200,
    sumUpTransactionId: "sumup-txn-1",
    attemptStatus: "processing",
    alreadyClaimed: false,
  });
  completeWalletRefundRequestMock.mockImplementation(async () => {
    if (state.refundRequest) {
      state.refundRequest = {
        ...state.refundRequest,
        status: "completed",
        admin_note: "Paid manually",
        metadata: {
          ...state.refundRequest.metadata,
          refund_completed_transaction_id: 700,
          processed_by: "admin-1",
        },
      };
    }

    return {
      success: true,
      refundRequestId: 501,
      refundTransactionId: 700,
      reason: null,
      completedBalance: 4,
      reservedRefundAmount: 0,
      availableBalance: 4,
    };
  });
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
    expect(claimSumUpRefundAttemptMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("rejects a pending request without changing wallet balance", async () => {
    const response = await PATCH(
      requestBody("reject", "Customer asked to cancel") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(claimSumUpRefundAttemptMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(state.refundRequest).toMatchObject({
      status: "cancelled",
      admin_note: "Customer asked to cancel",
    });
    expect(body.refund_request.metadata).toMatchObject({
      rejected_by: "admin-1",
      rejection_reason: "Customer asked to cancel",
    });
  });

  it("approves a pending request with the refund completion RPC", async () => {
    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(claimSumUpRefundAttemptMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).toHaveBeenCalledTimes(1);
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      adminUserId: "admin-1",
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
    expect(body.refund_transaction).toEqual({ id: 700 });
    expect(body.balance_breakdown).toEqual({
      completed_balance: 4,
      reserved_refund_amount: 0,
      available_balance: 4,
    });
  });

  it("test-claims a SumUp refund attempt without calling SumUp or completing the wallet refund", async () => {
    const response = await PATCH(
      requestBody("claim_sumup_refund") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(claimSumUpRefundAttemptMock).toHaveBeenCalledTimes(1);
    expect(claimSumUpRefundAttemptMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      adminUserId: "admin-1",
    });
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      message: "SumUp refund attempt claimed for testing. The customer has not been refunded.",
      refund_request: {
        id: 501,
        status: "processing",
      },
      sumup_refund_attempt: {
        id: 900,
        status: "processing",
        already_claimed: false,
        amount: 8,
        currency: "GBP",
        booking_payment_id: 300,
        source_wallet_transaction_id: 200,
        sumup_transaction_id: "sumup-txn-1",
      },
    });
  });

  it("does not call SumUp when the refund attempt has already been claimed", async () => {
    claimSumUpRefundAttemptMock.mockResolvedValue({
      success: true,
      attemptId: 900,
      reason: null,
      refundRequestId: 501,
      amount: 8,
      currency: "GBP",
      bookingPaymentId: 300,
      sourceWalletTransactionId: 200,
      sumUpTransactionId: "sumup-txn-1",
      attemptStatus: "processing",
      alreadyClaimed: true,
    });

    const response = await PATCH(
      requestBody("claim_sumup_refund") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sumup_refund_attempt.already_claimed).toBe(true);
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("returns a safe error when SumUp refund attempt claim fails without calling SumUp", async () => {
    claimSumUpRefundAttemptMock.mockResolvedValue({
      success: false,
      attemptId: null,
      reason: "missing_sumup_transaction_reference",
      refundRequestId: 501,
      amount: 0,
      currency: "GBP",
      bookingPaymentId: 300,
      sourceWalletTransactionId: 200,
      sumUpTransactionId: null,
      attemptStatus: null,
      alreadyClaimed: false,
    });

    const response = await PATCH(
      requestBody("claim_sumup_refund") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Refund request is missing a SumUp transaction reference.",
      reason: "missing_sumup_transaction_reference",
    });
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
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
    expect(completeWalletRefundRequestMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the request pending when wallet balance is insufficient", async () => {
    completeWalletRefundRequestMock.mockResolvedValue({
      success: false,
      refundRequestId: 501,
      refundTransactionId: null,
      reason: "insufficient_balance",
      completedBalance: 8,
      reservedRefundAmount: 8,
      availableBalance: 0,
    });

    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Insufficient wallet balance for this refund.");
    expect(state.refundRequest).toMatchObject({
      status: "pending",
      admin_note: null,
    });
  });
});
