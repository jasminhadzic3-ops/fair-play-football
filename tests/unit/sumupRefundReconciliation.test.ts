import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessageMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const retrieveValidatedSumUpTransactionForPaymentMock = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureMessage: captureMessageMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/sumupPayments", () => ({
  retrieveValidatedSumUpTransactionForPayment: retrieveValidatedSumUpTransactionForPaymentMock,
}));

import {
  classifySumUpTransactionRefundEvidence,
  reconcileUnknownSumUpRefundAttempt,
  retrieveSumUpRefundEvidenceForAttempt,
  type SumUpRefundEvidenceResult,
} from "@/lib/sumupRefundReconciliation";
import type { SumUpRefundAttempt } from "@/lib/wallet";

const defaultAttempt: SumUpRefundAttempt = {
  id: 900,
  refund_request_id: 501,
  source_wallet_transaction_id: 200,
  booking_payment_id: 300,
  requested_by: "admin-old",
  sumup_transaction_id: "sumup-txn-1",
  amount: 12,
  currency: "GBP",
  status: "processing",
  idempotency_key: "sumup_refund_attempt:request:501:tx:1",
  error_message: null,
  sumup_response: {},
  metadata: {
    transaction_code: "TXN-1",
  },
  created_at: "2026-07-13T10:00:00.000Z",
  updated_at: "2026-07-13T10:00:00.000Z",
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
  claimResult?: SumUpRefundAttempt | null;
  latestAttempt?: SumUpRefundAttempt | null;
  evidenceResult?: SumUpRefundEvidenceResult;
  completion?: Partial<typeof defaultCompletion>;
  updateResult?: unknown;
} = {}) {
  const claimAttempt = vi.fn().mockResolvedValue(
    Object.prototype.hasOwnProperty.call(overrides, "claimResult")
      ? overrides.claimResult
      : defaultAttempt
  );
  const getLatestAttempt = vi.fn().mockResolvedValue(overrides.latestAttempt ?? defaultAttempt);
  const updateAttemptStatus = vi.fn().mockResolvedValue(
    Object.prototype.hasOwnProperty.call(overrides, "updateResult")
      ? overrides.updateResult
      : { ...defaultAttempt, status: "succeeded" }
  );
  const restoreRefundRequestToPending = vi.fn().mockResolvedValue({ id: 501, status: "pending" });
  const completeRefundRequest = vi.fn().mockResolvedValue({
    ...defaultCompletion,
    ...overrides.completion,
  });
  const retrieveEvidence = vi.fn().mockResolvedValue(
    overrides.evidenceResult ?? {
      outcome: "refund_confirmed",
      message: "SumUp evidence confirms the refund succeeded.",
      evidence: {
        source: "sumup_refund_event",
        transaction_id: "sumup-txn-1",
        event_type: "REFUND_SUCCEEDED",
        event_status: "SUCCESSFUL",
        event_amount: 12,
        event_currency: "GBP",
      },
    }
  );

  return {
    claimAttempt,
    getLatestAttempt,
    updateAttemptStatus,
    restoreRefundRequestToPending,
    completeRefundRequest,
    retrieveEvidence,
  };
}

async function runWith(deps: ReturnType<typeof setup>) {
  return reconcileUnknownSumUpRefundAttempt({
    refundRequestId: 501,
    adminUserId: "admin-1",
    claimAttempt: deps.claimAttempt,
    getLatestAttempt: deps.getLatestAttempt,
    updateAttemptStatus: deps.updateAttemptStatus as never,
    restoreRefundRequestToPending: deps.restoreRefundRequestToPending as never,
    completeRefundRequest: deps.completeRefundRequest as never,
    retrieveEvidence: deps.retrieveEvidence,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockReset();
  retrieveValidatedSumUpTransactionForPaymentMock.mockReset();
});

describe("reconcileUnknownSumUpRefundAttempt", () => {
  it("confirmed refund event completes the wallet exactly once", async () => {
    const deps = setup();

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "refund_confirmed",
      status: 200,
      refundTransactionId: 700,
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
        idempotencyKey: "refund_completed:sumup_attempt:900",
        completionSource: "automatic_sumup",
      })
    );
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
  });

  it("repeated reconciliation is idempotent for an already succeeded attempt", async () => {
    const deps = setup({
      claimResult: null,
      latestAttempt: {
        ...defaultAttempt,
        status: "succeeded",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "already_completed",
      status: 200,
      attemptId: 900,
    });
    expect(deps.retrieveEvidence).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("confirmed no-refund permits safe retry only when proven", async () => {
    const deps = setup({
      evidenceResult: {
        outcome: "not_refunded_retry_allowed",
        message: "SumUp evidence confirms the refund did not occur. The request is retryable.",
        evidence: {
          source: "sumup_refund_event",
          transaction_id: "sumup-txn-1",
          event_type: "REFUND_FAILED",
          event_status: "FAILED",
          event_amount: 12,
          event_currency: "GBP",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "not_refunded_retry_allowed",
      status: 200,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
      })
    );
    expect(deps.restoreRefundRequestToPending).toHaveBeenCalledWith({
      refundRequestId: 501,
      attemptId: 900,
    });
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("does not release a reservation when a no-refund reconciliation loses the local update race", async () => {
    const deps = setup({
      updateResult: null,
      evidenceResult: {
        outcome: "not_refunded_retry_allowed",
        message: "SumUp evidence confirms the refund did not occur. The request is retryable.",
        evidence: {
          source: "sumup_refund_event",
          transaction_id: "sumup-txn-1",
          event_type: "REFUND_FAILED",
          event_status: "FAILED",
          event_amount: 12,
          event_currency: "GBP",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "manual_review",
      status: 409,
    });
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("pending or inconclusive evidence remains unknown and reserved", async () => {
    const deps = setup({
      evidenceResult: {
        outcome: "still_unknown",
        message: "SumUp refund evidence is still pending or inconclusive.",
        evidence: {
          source: "sumup_refund_event",
          transaction_id: "sumup-txn-1",
          reason: "pending_refund_event",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "still_unknown",
      status: 200,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
      })
    );
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("does not release or complete when an unknown reconciliation loses the local update race", async () => {
    const deps = setup({
      updateResult: null,
      evidenceResult: {
        outcome: "still_unknown",
        message: "SumUp refund evidence is still pending or inconclusive.",
        evidence: {
          source: "sumup_refund_event",
          transaction_id: "sumup-txn-1",
          reason: "pending_refund_event",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "manual_review",
      status: 409,
    });
    expect(deps.restoreRefundRequestToPending).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("conflicting amount remains manual review", async () => {
    const deps = setup({
      evidenceResult: {
        outcome: "manual_review",
        message: "SumUp refund evidence has a conflicting amount. Manual review is required.",
        evidence: {
          source: "sumup_refund_event",
          transaction_id: "sumup-txn-1",
          event_amount: 10,
          event_currency: "GBP",
          reason: "amount_mismatch",
        },
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "manual_review",
      status: 409,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
      })
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "SumUp refund reconciliation requires manual review",
      expect.objectContaining({
        level: "warning",
      })
    );
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("missing transaction remains manual review", async () => {
    const deps = setup();
    deps.retrieveEvidence.mockRejectedValueOnce(new Error("No transaction found."));

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "manual_review",
      status: 409,
    });
    expect(deps.updateAttemptStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        errorMessage: "Unable to retrieve SumUp reconciliation evidence. Manual review is required.",
      })
    );
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });

  it("concurrent reconciliation cannot complete twice", async () => {
    const deps = setup({
      claimResult: null,
      latestAttempt: {
        ...defaultAttempt,
        status: "processing",
      },
    });

    const result = await runWith(deps);

    expect(result).toMatchObject({
      result: "still_unknown",
      status: 409,
    });
    expect(deps.retrieveEvidence).not.toHaveBeenCalled();
    expect(deps.completeRefundRequest).not.toHaveBeenCalled();
  });
});

describe("retrieveSumUpRefundEvidenceForAttempt", () => {
  function mockBookingPayment(row: Record<string, unknown> | null) {
    supabaseFromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: row,
        error: null,
      }),
    });
  }

  it("uses the preferred SumUp transaction id path when the booking payment has one", async () => {
    const payment = {
      id: 300,
      amount: 12,
      currency: "GBP",
      transaction_code: "TXN-1",
      sumup_transaction_id: "sumup-txn-1",
    };
    mockBookingPayment(payment);
    retrieveValidatedSumUpTransactionForPaymentMock.mockResolvedValue({
      id: "sumup-txn-1",
      transaction_code: "TXN-1",
      amount: 12,
      currency: "GBP",
      status: "REFUNDED",
      transaction_events: [
        {
          event_type: "REFUND",
          status: "REFUNDED",
          amount: 12,
          currency: "GBP",
        },
      ],
    });

    const result = await retrieveSumUpRefundEvidenceForAttempt(defaultAttempt);

    expect(retrieveValidatedSumUpTransactionForPaymentMock).toHaveBeenCalledWith(payment);
    expect(result).toMatchObject({
      outcome: "refund_confirmed",
      evidence: {
        event_type: "REFUND",
        event_status: "REFUNDED",
      },
    });
  });

  it("passes transaction code only when no SumUp transaction id is stored", async () => {
    const payment = {
      id: 300,
      amount: 12,
      currency: "GBP",
      transaction_code: "TXN-1",
      sumup_transaction_id: null,
    };
    mockBookingPayment(payment);
    retrieveValidatedSumUpTransactionForPaymentMock.mockResolvedValue({
      id: "sumup-txn-1",
      transaction_code: "TXN-1",
      amount: 12,
      currency: "GBP",
      status: "SUCCESSFUL",
      events: [
        {
          event_type: "REFUND",
          status: "SUCCESSFUL",
          amount: 12,
          currency: "GBP",
        },
      ],
    });

    await retrieveSumUpRefundEvidenceForAttempt(defaultAttempt);

    expect(retrieveValidatedSumUpTransactionForPaymentMock).toHaveBeenCalledWith(payment);
  });

  it("returns manual review when no local SumUp identifier is available", async () => {
    mockBookingPayment({
      id: 300,
      amount: 12,
      currency: "GBP",
      transaction_code: null,
      sumup_transaction_id: null,
    });

    const result = await retrieveSumUpRefundEvidenceForAttempt(defaultAttempt);

    expect(result).toMatchObject({
      outcome: "manual_review",
      evidence: {
        reason: "missing_transaction_code",
      },
    });
    expect(retrieveValidatedSumUpTransactionForPaymentMock).not.toHaveBeenCalled();
  });
});

describe("classifySumUpTransactionRefundEvidence", () => {
  it("confirms matching successful refund events", () => {
    const result = classifySumUpTransactionRefundEvidence(
      {
        id: "sumup-txn-1",
        transaction_code: "TXN-1",
        amount: 12,
        currency: "GBP",
        status: "SUCCESSFUL",
        events: [
          {
            id: "event-1",
            event_type: "REFUND_SUCCEEDED",
            status: "SUCCESSFUL",
            amount: 12,
            currency: "GBP",
          },
        ],
      },
      defaultAttempt
    );

    expect(result).toMatchObject({
      outcome: "refund_confirmed",
      evidence: {
        event_amount: 12,
        event_currency: "GBP",
      },
    });
  });

  it("permits retry only for matching failed refund events", () => {
    const result = classifySumUpTransactionRefundEvidence(
      {
        id: "sumup-txn-1",
        transaction_code: "TXN-1",
        amount: 12,
        currency: "GBP",
        status: "SUCCESSFUL",
        events: [
          {
            id: "event-1",
            event_type: "REFUND_FAILED",
            status: "FAILED",
            amount: 12,
            currency: "GBP",
          },
        ],
      },
      defaultAttempt
    );

    expect(result).toMatchObject({
      outcome: "not_refunded_retry_allowed",
      evidence: {
        reason: "matched_failed_refund_event",
      },
    });
  });

  it("keeps pending or absent refund evidence unknown", () => {
    const result = classifySumUpTransactionRefundEvidence(
      {
        id: "sumup-txn-1",
        transaction_code: "TXN-1",
        amount: 12,
        currency: "GBP",
        status: "SUCCESSFUL",
        events: [
          {
            id: "event-1",
            event_type: "PAYMENT_CAPTURED",
            status: "SUCCESSFUL",
            amount: 12,
            currency: "GBP",
          },
        ],
      },
      defaultAttempt
    );

    expect(result).toMatchObject({
      outcome: "still_unknown",
      evidence: {
        reason: "no_refund_events",
      },
    });
  });

  it("treats conflicting refund amounts as manual review", () => {
    const result = classifySumUpTransactionRefundEvidence(
      {
        id: "sumup-txn-1",
        transaction_code: "TXN-1",
        amount: 12,
        currency: "GBP",
        status: "SUCCESSFUL",
        events: [
          {
            id: "event-1",
            event_type: "REFUND_SUCCEEDED",
            status: "SUCCESSFUL",
            amount: 10,
            currency: "GBP",
          },
        ],
      },
      defaultAttempt
    );

    expect(result).toMatchObject({
      outcome: "manual_review",
      evidence: {
        reason: "amount_mismatch",
      },
    });
  });
});
