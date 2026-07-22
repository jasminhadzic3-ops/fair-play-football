import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const buildAdminRefundCandidatesMock = vi.hoisted(() => vi.fn());
const getAutomaticRefundDependencyMock = vi.hoisted(() => vi.fn());
const processAutomaticSumUpRefundMock = vi.hoisted(() => vi.fn());
const createWalletRefundRequestMock = vi.hoisted(() => vi.fn());
const getLatestSumUpRefundAttemptForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/adminRefundCandidates", () => ({
  buildAdminRefundCandidates: buildAdminRefundCandidatesMock,
}));

vi.mock("@/lib/sumupRefundDependencies", () => ({
  getAutomaticRefundDependency: getAutomaticRefundDependencyMock,
}));

vi.mock("@/lib/sumupRefundProcessing", () => ({
  processAutomaticSumUpRefund: processAutomaticSumUpRefundMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/wallet", () => ({
  createWalletRefundRequest: createWalletRefundRequestMock,
  getLatestSumUpRefundAttemptForRequest: getLatestSumUpRefundAttemptForRequestMock,
}));

import { POST } from "@/app/api/admin/refund-requests/route";

type TableRow = Record<string, unknown>;
type Filter = { field: string; value: unknown };

const state: {
  sourceCredit: TableRow | null;
  games: TableRow[];
  bookings: TableRow[];
  profiles: TableRow[];
  bookingPayments: TableRow[];
  bookingWalletTransactions: TableRow[];
  refundRequests: TableRow[];
  sumupRefundAttempts: TableRow[];
  candidates: TableRow[];
} = {
  sourceCredit: null,
  games: [],
  bookings: [],
  profiles: [],
  bookingPayments: [],
  bookingWalletTransactions: [],
  refundRequests: [],
  sumupRefundAttempts: [],
  candidates: [],
};

class MockSupabaseQuery {
  private filters: Filter[] = [];

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  in() {
    return this;
  }

  async maybeSingle<T>() {
    if (this.table === "wallet_transactions") {
      return { data: state.sourceCredit as T | null, error: null };
    }

    return { data: null as T | null, error: null };
  }

  then<TResult1 = { data: TableRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    let data: TableRow[] = [];

    if (this.table === "games") {
      data = state.games;
    } else if (this.table === "bookings") {
      data = state.bookings;
    } else if (this.table === "profiles") {
      data = state.profiles;
    } else if (this.table === "booking_payments") {
      data = state.bookingPayments;
    } else if (this.table === "sumup_refund_attempts") {
      data = state.sumupRefundAttempts;
    } else if (this.table === "wallet_transactions") {
      data = this.filters.some(
        (filter) => filter.field === "transaction_type" && filter.value === "refund_requested"
      )
        ? state.refundRequests
        : state.bookingWalletTransactions;
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function requestBody(sourceWalletTransactionId: unknown = 900) {
  return new Request("http://localhost/api/admin/refund-requests", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_wallet_transaction_id: sourceWalletTransactionId,
    }),
  });
}

function eligibleCandidate(overrides: TableRow = {}) {
  return {
    source_wallet_transaction_id: 900,
    game_id: 10,
    booking_id: 100,
    payment_id: 200,
    user_id: "user-1",
    player_name: "Refund Player",
    amount: 8,
    currency: "GBP",
    original_payment_method: "sumup",
    refund_status: "eligible",
    refund_eligible: true,
    safe_reason: "Eligible for full SumUp refund.",
    refund_request_id: null,
    refund_request_status: null,
    sumup_refund_attempt_id: null,
    sumup_refund_attempt_status: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  buildAdminRefundCandidatesMock.mockImplementation(() => state.candidates);
  getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
  createWalletRefundRequestMock.mockResolvedValue({
    success: true,
    refundRequestId: 501,
    reason: null,
    alreadyExists: false,
    completedBalance: 8,
    reservedRefundAmount: 8,
    availableBalance: 0,
  });
  getLatestSumUpRefundAttemptForRequestMock.mockResolvedValue(null);
  processAutomaticSumUpRefundMock.mockResolvedValue({
    outcome: "completed",
    status: 200,
    message: "SumUp refund completed and wallet balance was updated.",
    attemptId: 700,
    refundRequestId: 501,
    refundTransactionId: 800,
    skippedSumUpRefundCall: false,
    balanceBreakdown: {
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    },
  });
  state.sourceCredit = {
    id: 900,
    user_id: "user-1",
    game_id: 10,
    booking_id: 100,
    payment_id: 200,
    amount: 8,
    currency: "GBP",
    transaction_type: "game_cancelled_credit",
    status: "completed",
    metadata: {
      original_payment_method: "sumup",
      original_game_id: 10,
      original_booking_id: 100,
      original_payment_id: 200,
    },
  };
  state.games = [{ id: 10, status: "cancelled" }];
  state.bookings = [{ id: 100, game_id: 10, user_id: "user-1", player_name: "Refund Player" }];
  state.profiles = [{ id: "user-1", username: "Refund Player" }];
  state.bookingPayments = [
    {
      id: 200,
      user_id: "user-1",
      game_id: 10,
      booking_id: 100,
      payment_status: "paid",
      amount: 8,
      currency: "GBP",
      transaction_code: "hidden-code",
      sumup_transaction_id: "hidden-id",
    },
  ];
  state.bookingWalletTransactions = [];
  state.refundRequests = [];
  state.sumupRefundAttempts = [];
  state.candidates = [eligibleCandidate()];
});

describe("admin refund request creation route", () => {
  it("creates one refund request and invokes the existing processor once for an eligible credit", async () => {
    const response = await POST(requestBody() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).toHaveBeenCalledWith({
      userId: "user-1",
      sourceWalletTransactionId: 900,
    });
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledTimes(1);
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        refundRequestId: 501,
        actorUserId: "admin-1",
        initiatedBy: "admin",
      })
    );
    expect(body.refund_request).toEqual({ id: 501, status: "completed" });
    expect(body.automatic_refund).toEqual(
      expect.objectContaining({
        status: "completed",
      })
    );
    expect(JSON.stringify(body)).not.toContain("hidden-code");
    expect(JSON.stringify(body)).not.toContain("hidden-id");
  });

  it("returns an existing request without issuing another processor call", async () => {
    state.candidates = [
      eligibleCandidate({
        refund_status: "requested",
        refund_eligible: false,
        safe_reason: "Refund request already exists.",
        refund_request_id: 501,
        refund_request_status: "pending",
      }),
    ];

    const response = await POST(requestBody() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(body.already_exists).toBe(true);
    expect(body.refund_request).toEqual({ id: 501, status: "existing" });
  });

  it("blocks unknown attempts and points Admin to reconciliation without another processor call", async () => {
    state.candidates = [
      eligibleCandidate({
        refund_status: "needs_review",
        refund_eligible: false,
        safe_reason: "Refund needs review. Use Recheck SumUp before retrying.",
        refund_request_id: 501,
        refund_request_status: "processing",
        sumup_refund_attempt_id: 700,
        sumup_refund_attempt_status: "unknown",
      }),
    ];

    const response = await POST(requestBody() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(body.automatic_refund.message).toContain("Recheck SumUp");
  });

  it("rejects non-eligible credits without creating a refund request", async () => {
    state.candidates = [
      eligibleCandidate({
        refund_status: "not_eligible",
        refund_eligible: false,
        safe_reason: "Linked player, game, booking and payment details do not match.",
      }),
    ];

    const response = await POST(requestBody() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Linked player, game, booking and payment details do not match.");
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
  });

  it("does not process an already-existing request returned by the wallet RPC", async () => {
    createWalletRefundRequestMock.mockResolvedValue({
      success: true,
      refundRequestId: 501,
      reason: null,
      alreadyExists: true,
      completedBalance: 8,
      reservedRefundAmount: 8,
      availableBalance: 0,
    });

    const response = await POST(requestBody() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(body.refund_request).toEqual({ id: 501, status: "existing" });
  });

  it("blocks non-admin users", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await POST(requestBody() as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
  });
});
