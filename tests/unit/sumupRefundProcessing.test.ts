import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureMessage: captureMessageMock,
}));

import { processAutomaticSumUpRefund, type SumUpRefundDependencyResult } from "@/lib/sumupRefundProcessing";

const defaultClaim = {
  success: true,
  attemptId: 900,
  reason: null,
  refundRequestId: 501,
  amount: 12,
  currency: "GBP",
  bookingPaymentId: 300,
  sourceWalletTransactionId: 200,
  sumUpTransactionId: "sumup-txn-1",
  attemptStatus: "processing",
  alreadyClaimed: false,
};

const defaultCompletion = {
  success: true,
  refundRequestId: 501,
  refundTransactionId: 700,
  reason: null,
  completedBalance: 0,
  reservedRefundAmount: 0,
  availableBalance: 0,
};

function setup(overrides: {
  claim?: Record<string, unknown>;
  refundResult?: SumUpRefundDependencyResult;
  completion?: Record<string, unknown>;
  originalPayment?: { amount: number; currency: string | null } | null;
} = {}) {
  const claimAttempt = vi.fn().mockResolvedValue({
    ...defaultClaim,
    ...overrides.claim,
  });
  const refundDependency = vi.fn().mockResolvedValue(
    overrides.refundResult ?? {
      outcome: "succeeded",
      response: {
        id: "mock-refund-1",
        status: "SUCCESSFUL",
      },
    }
  );
  const completeRefundRequest = vi.fn().mockResolvedValue({
    ...defaultCompletion,
    ...overrides.completion,
  });
  const resolveTransactionId = vi.fn().mockResolvedValue("sumup-txn-1");
  const persistTransactionIdForAttempt = vi.fn().mockResolvedValue({
    id: 900,
    status: "processing",
    sumup_transaction_id: "sumup-txn-1",
  });
  const updateAttemptStatus = vi.fn().mockResolvedValue({ id: 900, status: "succeeded" });
  const restoreRefundRequestToPending = vi.fn().mockResolvedValue({ id: 501, status: "pending" });
  const loadOriginalPayment = vi.fn().mockResolvedValue(
    overrides.originalPayment === undefined
      ? { amount: 12, currency: "GBP" }
      : overrides.originalPayment
  );

  return {
    claimAttempt,
    refundDependency,
    completeRefundRequest,
    resolveTransactionId,
    persistTransactionIdForAttempt,
    updateAttemptStatus,
    restoreRefundRequestToPending,
    loadOriginalPayment,
  };
}

async function runWith(deps: ReturnType<typeof setup>) {
  return processAutomaticSumUpRefund({
    refundRequestId: 501,
    adminUserId: "admin-1",
    refundDependency: deps.refundDependency,
    claimAttempt: deps.claimAttempt as never,
    completeRefundRequest: deps.completeRefundRequest as never,
    resolveTransactionId: deps.resolveTransactionId as never,
    persistTransactionIdForAttempt: deps.persistTransactionIdForAttempt as never,
    updateAttemptStatus: deps.updateAttemptStatus as never,
    restoreRefundRequestToPending: deps.restoreRefundRequestToPending as never,
    loadOriginalPayment: deps.loadOriginalPayment as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processAutomaticSumUpRefund", () => {
  it("does not call the refund dependency when claim fails", async () => {
    const deps = setup({
      claim: {
        success: false,
        reason: "missing_sumup_transaction_reference",
        attemptId: null,
        sumUpTransactionId: null,
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "claim_failed",
      status: 400,
    });
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("does not call the refund dependency for an existing processing attempt", async () => {
    const deps = setup({
      claim: {
        alreadyClaimed: true,
        attemptStatus: "processing",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "blocked",
      status: 409,
      attemptStatus: "processing",
    });
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("does not call the refund dependency for an existing unknown attempt", async () => {
    const deps = setup({
      claim: {
        alreadyClaimed: true,
        attemptStatus: "unknown",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "blocked",
      status: 409,
      attemptStatus: "unknown",
    });
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("retries only DB completion for an existing succeeded attempt", async () => {
    const deps = setup({
      claim: {
        alreadyClaimed: true,
        attemptStatus: "succeeded",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "completed",
      skippedSumUpRefundCall: true,
    });
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).toHaveBeenCalledTimes(1);
    expect(deps.completeRefundRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "refund_completed:sumup_attempt:900",
      })
    );
  });

  it("marks a mocked success succeeded and completes the wallet refund", async () => {
    const deps = setup();

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "completed",
      skippedSumUpRefundCall: false,
      refundTransactionId: 700,
    });
    expect(deps.refundDependency).toHaveBeenCalledTimes(1);
    expect(deps.loadOriginalPayment).toHaveBeenCalledWith(300);
    expect(deps.refundDependency).toHaveBeenCalledWith({
      transactionId: "sumup-txn-1",
      amount: 12,
      originalPaymentAmount: 12,
      currency: "GBP",
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 900,
        refundRequestId: 501,
        status: "succeeded",
      })
    );
    expect(deps.completeRefundRequest).toHaveBeenCalledTimes(1);
    expect(deps.completeRefundRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        completionSource: "automatic_sumup",
        metadata: expect.not.objectContaining({
          manual: true,
        }),
      })
    );
  });

  it("resolves and persists a missing SumUp transaction id before refunding", async () => {
    const deps = setup({
      claim: {
        sumUpTransactionId: null,
      },
    });
    deps.resolveTransactionId.mockResolvedValue("resolved-txn-1");

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "completed",
      skippedSumUpRefundCall: false,
    });
    expect(deps.resolveTransactionId).toHaveBeenCalledWith(300);
    expect(deps.persistTransactionIdForAttempt).toHaveBeenCalledWith({
      attemptId: 900,
      refundRequestId: 501,
      sumUpTransactionId: "resolved-txn-1",
    });
    expect(deps.refundDependency).toHaveBeenCalledWith({
      transactionId: "resolved-txn-1",
      amount: 12,
      originalPaymentAmount: 12,
      currency: "GBP",
    });
  });

  it("blocks before refunding when the original paid amount cannot be loaded", async () => {
    const deps = setup({
      originalPayment: null,
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "blocked",
      status: 409,
      error: "Refund request is not linked to a paid SumUp payment amount.",
    });
    expect(deps.loadOriginalPayment).toHaveBeenCalledWith(300);
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.updateAttemptStatus).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("blocks without a refund call when transaction lookup fails", async () => {
    const deps = setup({
      claim: {
        sumUpTransactionId: null,
      },
    });
    deps.resolveTransactionId.mockRejectedValue(new Error("lookup failed"));

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "blocked",
      status: 409,
      error: "lookup failed",
    });
    expect(deps.persistTransactionIdForAttempt).not.toHaveBeenCalled();
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("blocks without a refund call when transaction id persistence loses the processing race", async () => {
    const deps = setup({
      claim: {
        sumUpTransactionId: null,
      },
    });
    deps.persistTransactionIdForAttempt.mockResolvedValue(null);

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "blocked",
      status: 409,
    });
    expect(deps.refundDependency).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("does not create a wallet debit for an explicit mocked failure", async () => {
    const deps = setup({
      refundResult: {
        outcome: "failed",
        errorMessage: "Mocked failure.",
        response: {
          upstream_http_status: 403,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "problem_json",
          problem_type: "https://developer.sumup.com/problem/request-not-allowed",
          title: "Request not allowed.",
          detail: "The request is authenticated but not permitted.",
          error_code: "request_not_allowed",
          safe_message: "The request is authenticated but not permitted.",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "sumup_failed",
      status: 502,
      diagnosticCode: "sumup_refund_403_request_not_allowed",
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Mocked failure.",
        sumUpResponse: expect.objectContaining({
          upstream_http_status: 403,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "problem_json",
          problem_type: "https://developer.sumup.com/problem/request-not-allowed",
          title: "Request not allowed.",
          detail: "The request is authenticated but not permitted.",
          error_code: "request_not_allowed",
          safe_message: "The request is authenticated but not permitted.",
        }),
        metadata: expect.objectContaining({
          sumup_refund_diagnostic_code: "sumup_refund_403_request_not_allowed",
          sumup_refund_upstream_http_status: 403,
          sumup_refund_endpoint_family: "transactions_refund_v1_merchant_payment",
          sumup_refund_response_body_kind: "problem_json",
        }),
      })
    );
    expect(deps.restoreRefundRequestToPending).toHaveBeenCalledWith({
      refundRequestId: 501,
      attemptId: 900,
    });
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("marks ambiguous mocked outcomes unknown, keeps the reservation, and creates no wallet debit", async () => {
    const deps = setup({
      refundResult: {
        outcome: "unknown",
        errorMessage: "Mocked timeout.",
        response: {
          upstream_http_status: 409,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "json",
          error_code: "CONFLICT",
          safe_message: "Conflict.",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "sumup_unknown",
      status: 502,
      diagnosticCode: "sumup_refund_409_conflict",
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        errorMessage: "Mocked timeout.",
        sumUpResponse: expect.objectContaining({
          upstream_http_status: 409,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "json",
          error_code: "CONFLICT",
          safe_message: "Conflict.",
        }),
        metadata: expect.objectContaining({
          sumup_refund_diagnostic_code: "sumup_refund_409_conflict",
          sumup_refund_upstream_http_status: 409,
          sumup_refund_endpoint_family: "transactions_refund_v1_merchant_payment",
          sumup_refund_response_body_kind: "json",
        }),
      })
    );
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      "SumUp refund outcome is unknown",
      expect.objectContaining({
        level: "warning",
        tags: {
          area: "sumup_refunds",
          outcome: "unknown",
        },
        extra: expect.objectContaining({
          refund_request_id: 501,
          sumup_refund_attempt_id: 900,
          error_message: "Mocked timeout.",
        }),
      })
    );
  });

  it("preserves a succeeded attempt when wallet DB completion fails", async () => {
    const deps = setup({
      completion: {
        success: false,
        refundTransactionId: null,
        reason: "insufficient_balance",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "wallet_completion_failed",
      status: 409,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
      })
    );
    expect(deps.refundDependency).toHaveBeenCalledTimes(1);
    expect(deps.completeRefundRequest).toHaveBeenCalledTimes(1);
  });
});
