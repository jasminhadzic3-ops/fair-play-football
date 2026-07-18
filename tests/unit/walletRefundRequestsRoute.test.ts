import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const createWalletRefundRequestMock = vi.hoisted(() => vi.fn());
const getLatestSumUpRefundAttemptForRequestMock = vi.hoisted(() => vi.fn());
const getAutomaticRefundDependencyMock = vi.hoisted(() => vi.fn());
const processAutomaticSumUpRefundMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
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

import { POST } from "@/app/api/wallet/refund-requests/route";

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

function successfulRefundRequest(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    refundRequestId: 123,
    reason: null,
    alreadyExists: false,
    completedBalance: 12,
    reservedRefundAmount: 8,
    availableBalance: 4,
    ...overrides,
  };
}

class MockSupabaseQuery {
  private status = "pending";

  constructor(status = "pending") {
    this.status = status;
  }

  select() {
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle<T>() {
    return {
      data: { status: this.status } as T,
      error: null,
    };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email: "player@example.com",
  });
  createWalletRefundRequestMock.mockResolvedValue(successfulRefundRequest());
  getLatestSumUpRefundAttemptForRequestMock.mockResolvedValue(null);
  getAutomaticRefundDependencyMock.mockReturnValue(null);
  processAutomaticSumUpRefundMock.mockResolvedValue({
    outcome: "completed",
    status: 200,
    message: "SumUp refund completed and wallet balance was updated.",
    attemptId: 900,
    refundRequestId: 123,
    refundTransactionId: 700,
    balanceBreakdown: {
      completedBalance: 4,
      reservedRefundAmount: 0,
      availableBalance: 4,
    },
    skippedSumUpRefundCall: false,
  });
  supabaseFromMock.mockReturnValue(new MockSupabaseQuery());
});

describe("wallet refund request route", () => {
  it("returns 401 when the user is signed out", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
  });

  it("requires a source wallet transaction id", async () => {
    const response = await POST(refundRequest(null) as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Please choose a refundable wallet credit.");
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
  });

  it("delegates atomic refund reservation to the wallet helper", async () => {
    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).toHaveBeenCalledWith({
      userId: "user-1",
      sourceWalletTransactionId: 900,
    });
    expect(body).toMatchObject({
      refund_request: {
        id: 123,
        status: "pending",
      },
      already_exists: false,
      automatic_refund: {
        status: "disabled",
        message: "Refund requested; awaiting processing.",
      },
      balance: 4,
      balance_breakdown: {
        completedBalance: 12,
        reservedRefundAmount: 8,
        availableBalance: 4,
      },
    });
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
  });

  it("runs automatic refund processing after the reservation when enabled", async () => {
    const refundDependency = vi.fn();
    getAutomaticRefundDependencyMock.mockReturnValue(refundDependency);

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).toHaveBeenCalledWith({
      userId: "user-1",
      sourceWalletTransactionId: 900,
    });
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith({
      refundRequestId: 123,
      actorUserId: "user-1",
      initiatedBy: "player",
      refundDependency,
    });
    expect(body).toMatchObject({
      refund_request: {
        id: 123,
        status: "completed",
      },
      automatic_refund: {
        status: "completed",
        message: "SumUp refund completed and wallet balance was updated.",
        refund_transaction: { id: 700 },
        sumup_refund_attempt: {
          id: 900,
          status: "succeeded",
          skipped_sumup_refund_call: false,
        },
      },
      balance: 4,
      balance_breakdown: {
        completedBalance: 4,
        reservedRefundAmount: 0,
        availableBalance: 4,
      },
    });
  });

  it("returns a safe failed automatic refund result without raw upstream data", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_failed",
      status: 502,
      error: "SumUp rejected the refund. No wallet debit was created.",
      diagnosticCode: "sumup_refund_403_request_not_allowed",
      attemptId: 900,
      refundRequestId: 123,
      raw_response: "secret raw body",
      authorization: "Bearer secret",
    });

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.automatic_refund).toEqual({
      status: "failed",
      message: "Automatic refund could not complete. Please try again later or contact support.",
      diagnostic_code: "sumup_refund_403_request_not_allowed",
      sumup_refund_attempt: {
        id: 900,
        status: "failed",
      },
    });
    expect(serialized).not.toContain("secret raw body");
    expect(serialized).not.toContain("Bearer");
  });

  it("returns manual review for unknown automatic refund outcomes", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_unknown",
      status: 502,
      error: "SumUp refund outcome is unknown. Reconcile manually before retrying.",
      diagnosticCode: "sumup_refund_409_conflict",
      attemptId: 901,
      refundRequestId: 123,
    });

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refund_request: {
        id: 123,
        status: "processing",
      },
      automatic_refund: {
        status: "manual_review",
        message: "Refund needs review; your wallet credit remains reserved.",
        diagnostic_code: "sumup_refund_409_conflict",
        sumup_refund_attempt: {
          id: 901,
          status: "unknown",
        },
      },
    });
  });

  it("does not immediately retry a recently failed automatic refund attempt", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    getLatestSumUpRefundAttemptForRequestMock.mockResolvedValue({
      id: 904,
      status: "failed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getLatestSumUpRefundAttemptForRequestMock).toHaveBeenCalledWith(123);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(body.automatic_refund).toEqual({
      status: "failed",
      message: "Automatic refund could not complete. Please wait before trying again or contact support.",
    });
  });

  it("returns processing for duplicate requests while an attempt is already active", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        refundRequestId: 55,
        alreadyExists: true,
      })
    );
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "blocked",
      status: 409,
      error: "A SumUp refund attempt is already processing. No SumUp refund was sent.",
      attemptStatus: "processing",
      attemptId: 902,
    });

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refund_request: {
        id: 55,
        status: "processing",
      },
      already_exists: true,
      automatic_refund: {
        status: "processing",
        message: "Refund processing.",
        sumup_refund_attempt: {
          id: 902,
          status: "processing",
        },
      },
    });
  });

  it("does not process an existing completed refund request again", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        refundRequestId: 55,
        alreadyExists: true,
      })
    );
    supabaseFromMock.mockReturnValue(new MockSupabaseQuery("completed"));

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      refund_request: {
        id: 55,
        status: "completed",
      },
      automatic_refund: {
        status: "completed",
        message: "Refund completed.",
      },
    });
  });

  it("keeps concurrent duplicate requests on the same existing processor path", async () => {
    const refundDependency = vi.fn();
    getAutomaticRefundDependencyMock.mockReturnValue(refundDependency);
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        refundRequestId: 55,
        alreadyExists: true,
      })
    );
    processAutomaticSumUpRefundMock
      .mockResolvedValueOnce({
        outcome: "completed",
        status: 200,
        message: "SumUp refund completed and wallet balance was updated.",
        attemptId: 900,
        refundRequestId: 55,
        refundTransactionId: 700,
        balanceBreakdown: {
          completedBalance: 4,
          reservedRefundAmount: 0,
          availableBalance: 4,
        },
        skippedSumUpRefundCall: false,
      })
      .mockResolvedValueOnce({
        outcome: "blocked",
        status: 409,
        error: "A SumUp refund attempt is already processing. No SumUp refund was sent.",
        attemptStatus: "processing",
        attemptId: 900,
      });

    const [firstResponse, secondResponse] = await Promise.all([
      POST(refundRequest() as Parameters<typeof POST>[0]),
      POST(refundRequest() as Parameters<typeof POST>[0]),
    ]);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledTimes(2);
    expect(processAutomaticSumUpRefundMock).toHaveBeenNthCalledWith(1, {
      refundRequestId: 55,
      actorUserId: "user-1",
      initiatedBy: "player",
      refundDependency,
    });
    expect(processAutomaticSumUpRefundMock).toHaveBeenNthCalledWith(2, {
      refundRequestId: 55,
      actorUserId: "user-1",
      initiatedBy: "player",
      refundDependency,
    });
    expect(firstBody.automatic_refund.status).toBe("completed");
    expect(secondBody.automatic_refund.status).toBe("processing");
  });

  it("returns an existing active request without treating it as an error", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        refundRequestId: 55,
        alreadyExists: true,
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refund_request: {
        id: 55,
        status: "existing",
      },
      already_exists: true,
    });
  });

  it("maps missing or unowned source credits to 404", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "source_credit_not_owned",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Refundable wallet credit not found.");
  });

  it("rejects non-SumUp cancellation credits", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "not_sumup_cancellation_credit",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only SumUp cancellation credits can be requested for card refund.");
  });

  it("rejects refund requests over available balance", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "insufficient_balance",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Refund amount cannot be greater than your wallet balance.");
  });
});
