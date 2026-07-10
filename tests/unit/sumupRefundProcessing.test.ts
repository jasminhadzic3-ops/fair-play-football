import { beforeEach, describe, expect, it, vi } from "vitest";
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
  const updateAttemptStatus = vi.fn().mockResolvedValue({ id: 900, status: "succeeded" });
  const restoreRefundRequestToPending = vi.fn().mockResolvedValue({ id: 501, status: "pending" });

  return {
    claimAttempt,
    refundDependency,
    completeRefundRequest,
    updateAttemptStatus,
    restoreRefundRequestToPending,
  };
}

async function runWith(deps: ReturnType<typeof setup>) {
  return processAutomaticSumUpRefund({
    refundRequestId: 501,
    adminUserId: "admin-1",
    refundDependency: deps.refundDependency,
    claimAttempt: deps.claimAttempt as never,
    completeRefundRequest: deps.completeRefundRequest as never,
    updateAttemptStatus: deps.updateAttemptStatus as never,
    restoreRefundRequestToPending: deps.restoreRefundRequestToPending as never,
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
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 900,
        refundRequestId: 501,
        status: "succeeded",
      })
    );
    expect(deps.completeRefundRequest).toHaveBeenCalledTimes(1);
  });

  it("does not create a wallet debit for an explicit mocked failure", async () => {
    const deps = setup({
      refundResult: {
        outcome: "failed",
        errorMessage: "Mocked failure.",
        response: { error_message: "Mocked failure." },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "sumup_failed",
      status: 502,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Mocked failure.",
      })
    );
    expect(deps.restoreRefundRequestToPending).toHaveBeenCalledWith({
      refundRequestId: 501,
      attemptId: 900,
    });
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("marks ambiguous mocked outcomes unknown and creates no wallet debit", async () => {
    const deps = setup({
      refundResult: {
        outcome: "unknown",
        errorMessage: "Mocked timeout.",
        response: { status: "UNKNOWN" },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      outcome: "sumup_unknown",
      status: 502,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        errorMessage: "Mocked timeout.",
      })
    );
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
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
