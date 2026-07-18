import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  retrieveValidatedSumUpTransactionForPayment,
  type SumUpTransaction,
  type SumUpTransactionEvent,
} from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  claimUnknownSumUpRefundAttemptForReconciliation,
  completeWalletRefundRequest,
  getLatestSumUpRefundAttemptForRequest,
  restoreRefundRequestToPendingAfterFailedSumUpAttempt,
  updateSumUpRefundAttemptStatus,
  type CompleteWalletRefundRequestResult,
  type SumUpRefundAttempt,
} from "@/lib/wallet";

export type SumUpRefundReconciliationResultCode =
  | "refund_confirmed"
  | "not_refunded_retry_allowed"
  | "still_unknown"
  | "already_completed"
  | "manual_review";

type EvidenceOutcome = Exclude<SumUpRefundReconciliationResultCode, "already_completed">;

type BookingPaymentForReconciliation = {
  id: number;
  amount: number | string;
  currency: string | null;
  transaction_code: string | null;
  sumup_transaction_id: string | null;
};

type SafeReconciliationEvidence = {
  source: string;
  transaction_id?: string | null;
  transaction_code?: string | null;
  event_id?: string | null;
  event_type?: string | null;
  event_status?: string | null;
  event_amount?: number | null;
  event_currency?: string | null;
  reason?: string;
};

export type SumUpRefundEvidenceResult = {
  outcome: EvidenceOutcome;
  message: string;
  evidence: SafeReconciliationEvidence;
};

export type SumUpRefundEvidenceDependency = (
  attempt: SumUpRefundAttempt
) => Promise<SumUpRefundEvidenceResult>;

type ReconcileUnknownSumUpRefundAttemptParams = {
  refundRequestId: number;
  adminUserId: string;
  claimAttempt?: typeof claimUnknownSumUpRefundAttemptForReconciliation;
  getLatestAttempt?: typeof getLatestSumUpRefundAttemptForRequest;
  updateAttemptStatus?: typeof updateSumUpRefundAttemptStatus;
  restoreRefundRequestToPending?: typeof restoreRefundRequestToPendingAfterFailedSumUpAttempt;
  completeRefundRequest?: typeof completeWalletRefundRequest;
  retrieveEvidence?: SumUpRefundEvidenceDependency;
};

export type SumUpRefundReconciliationResult = {
  status: number;
  result: SumUpRefundReconciliationResultCode;
  message: string;
  attemptId: number | null;
  refundRequestId: number;
  refundTransactionId?: number | null;
};

function normalizeAmountInMinorUnits(amount: number | string | null | undefined) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return null;
  }

  return Math.round(Math.abs(numericAmount) * 100);
}

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "GBP").trim().toUpperCase() || "GBP";
}

function boundedString(value: unknown, maxLength = 120) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function getEventLabel(event: SumUpTransactionEvent) {
  return [
    event.type,
    event.event_type,
    event.status,
    event.simple_status,
    event["name"],
    event["description"],
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
}

function getEventAmount(event: SumUpTransactionEvent) {
  return normalizeAmountInMinorUnits(event.amount);
}

function getEventCurrency(event: SumUpTransactionEvent, fallbackCurrency: string) {
  return normalizeCurrency(event.currency ?? fallbackCurrency);
}

function hasEventData(transaction: SumUpTransaction) {
  return collectRefundEvidenceEvents(transaction).length > 0;
}

function collectRefundEvidenceEvents(transaction: SumUpTransaction) {
  const eventCollections = [
    transaction.events,
    transaction.history,
    transaction.transaction_events,
    transaction.refunds,
    transaction.refund_events,
  ];

  return eventCollections.flatMap((collection) => (Array.isArray(collection) ? collection : []));
}

function getSafeEvidenceForEvent(
  source: string,
  transaction: SumUpTransaction,
  event: SumUpTransactionEvent,
  fallbackCurrency: string,
  reason?: string
): SafeReconciliationEvidence {
  return {
    source,
    transaction_id: boundedString(transaction.id),
    transaction_code: boundedString(transaction.transaction_code),
    event_id: boundedString(event.id),
    event_type: boundedString(event.event_type ?? event.type),
    event_status: boundedString(event.status ?? event.simple_status),
    event_amount: getEventAmount(event) === null ? null : getEventAmount(event)! / 100,
    event_currency: getEventCurrency(event, fallbackCurrency),
    reason,
  };
}

export function classifySumUpTransactionRefundEvidence(
  transaction: SumUpTransaction,
  attempt: SumUpRefundAttempt
): SumUpRefundEvidenceResult {
  const expectedAmount = normalizeAmountInMinorUnits(attempt.amount);
  const expectedCurrency = normalizeCurrency(attempt.currency);

  if (!expectedAmount || expectedAmount <= 0) {
    return {
      outcome: "manual_review",
      message: "Refund attempt amount is invalid; manual review is required.",
      evidence: {
        source: "local_attempt",
        transaction_id: boundedString(transaction.id),
        transaction_code: boundedString(transaction.transaction_code),
        reason: "invalid_attempt_amount",
      },
    };
  }

  if (attempt.sumup_transaction_id?.trim() && transaction.id !== attempt.sumup_transaction_id.trim()) {
    return {
      outcome: "manual_review",
      message: "SumUp transaction evidence did not match the original refund attempt.",
      evidence: {
        source: "sumup_transaction",
        transaction_id: boundedString(transaction.id),
        transaction_code: boundedString(transaction.transaction_code),
        reason: "transaction_id_mismatch",
      },
    };
  }

  const refundEvents = collectRefundEvidenceEvents(transaction).filter((event) =>
    getEventLabel(event).includes("REFUND")
  );

  if (!hasEventData(transaction)) {
    return {
      outcome: "still_unknown",
      message: "SumUp returned no refund event evidence yet. The reservation remains blocked.",
      evidence: {
        source: "sumup_transaction",
        transaction_id: boundedString(transaction.id),
        transaction_code: boundedString(transaction.transaction_code),
        reason: "missing_refund_events",
      },
    };
  }

  for (const event of refundEvents) {
    const eventAmount = getEventAmount(event);
    const eventCurrency = getEventCurrency(event, expectedCurrency);

    if (eventAmount !== null && eventAmount !== expectedAmount) {
      return {
        outcome: "manual_review",
        message: "SumUp refund evidence has a conflicting amount. Manual review is required.",
        evidence: getSafeEvidenceForEvent(
          "sumup_refund_event",
          transaction,
          event,
          expectedCurrency,
          "amount_mismatch"
        ),
      };
    }

    if (eventCurrency !== expectedCurrency) {
      return {
        outcome: "manual_review",
        message: "SumUp refund evidence has a conflicting currency. Manual review is required.",
        evidence: getSafeEvidenceForEvent(
          "sumup_refund_event",
          transaction,
          event,
          expectedCurrency,
          "currency_mismatch"
        ),
      };
    }
  }

  const matchingRefundEvents = refundEvents.filter((event) => {
    const eventAmount = getEventAmount(event);
    const eventCurrency = getEventCurrency(event, expectedCurrency);

    return eventAmount === expectedAmount && eventCurrency === expectedCurrency;
  });

  const successfulEvent = matchingRefundEvents.find((event) => {
    const label = getEventLabel(event);

    return (
      label.includes("SUCCESS") ||
      label.includes("SUCCEEDED") ||
      label.includes("SUCCESSFUL") ||
      label.includes("COMPLETED") ||
      label.includes("REFUNDED")
    );
  });

  if (successfulEvent) {
    return {
      outcome: "refund_confirmed",
      message: "SumUp evidence confirms the refund succeeded.",
      evidence: getSafeEvidenceForEvent(
        "sumup_refund_event",
        transaction,
        successfulEvent,
        expectedCurrency,
        "matched_successful_refund_event"
      ),
    };
  }

  const failedEvent = matchingRefundEvents.find((event) => {
    const label = getEventLabel(event);

    return (
      label.includes("FAILED") ||
      label.includes("DECLINED") ||
      label.includes("REJECTED") ||
      label.includes("CANCELLED") ||
      label.includes("CANCELED")
    );
  });

  if (failedEvent) {
    return {
      outcome: "not_refunded_retry_allowed",
      message: "SumUp evidence confirms the refund did not occur. The request is retryable.",
      evidence: getSafeEvidenceForEvent(
        "sumup_refund_event",
        transaction,
        failedEvent,
        expectedCurrency,
        "matched_failed_refund_event"
      ),
    };
  }

  return {
    outcome: "still_unknown",
    message: "SumUp refund evidence is still pending or inconclusive. The reservation remains blocked.",
    evidence: {
      source: "sumup_refund_event",
      transaction_id: boundedString(transaction.id),
      transaction_code: boundedString(transaction.transaction_code),
      reason: refundEvents.length > 0 ? "inconclusive_refund_events" : "no_refund_events",
    },
  };
}

async function loadBookingPaymentForAttempt(attempt: SumUpRefundAttempt) {
  if (!attempt.booking_payment_id) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("booking_payments")
    .select("id,amount,currency,transaction_code,sumup_transaction_id")
    .eq("id", attempt.booking_payment_id)
    .maybeSingle<BookingPaymentForReconciliation>();

  if (error) {
    throw error;
  }

  return data;
}

export async function retrieveSumUpRefundEvidenceForAttempt(attempt: SumUpRefundAttempt) {
  const payment = await loadBookingPaymentForAttempt(attempt);
  const transactionCode = payment?.transaction_code?.trim();

  if (!payment || (!payment.sumup_transaction_id?.trim() && !transactionCode)) {
    return {
      outcome: "manual_review",
      message: "The original SumUp transaction could not be located. Manual review is required.",
      evidence: {
        source: "booking_payment",
        reason: "missing_transaction_code",
      },
    } satisfies SumUpRefundEvidenceResult;
  }

  const transaction = await retrieveValidatedSumUpTransactionForPayment(payment);

  return classifySumUpTransactionRefundEvidence(transaction, attempt);
}

function getReconciliationMetadata(
  result: SumUpRefundEvidenceResult,
  adminUserId: string,
  completedAt = new Date().toISOString()
) {
  return {
    reconciliation_checked_by: adminUserId,
    reconciliation_checked_at: completedAt,
    reconciliation_result: result.outcome,
    reconciliation_evidence: result.evidence,
  };
}

function getSafeResponse(result: SumUpRefundEvidenceResult) {
  return {
    reconciliation_result: result.outcome,
    evidence: result.evidence,
  };
}

function warnUnknownOrManualReview(
  result: SumUpRefundEvidenceResult,
  attempt: SumUpRefundAttempt,
  refundRequestId: number
) {
  Sentry.captureMessage("SumUp refund reconciliation requires manual review", {
    level: "warning",
    tags: {
      sumup_refund_reconciliation_result: result.outcome,
    },
    extra: {
      refund_request_id: refundRequestId,
      sumup_refund_attempt_id: attempt.id,
      evidence: result.evidence,
    },
  });
}

function completedResult(
  refundRequestId: number,
  attempt: SumUpRefundAttempt,
  completionResult: CompleteWalletRefundRequestResult
): SumUpRefundReconciliationResult {
  return {
    status: 200,
    result: "refund_confirmed",
    message: "SumUp refund confirmed and wallet refund completed.",
    attemptId: attempt.id,
    refundRequestId,
    refundTransactionId: completionResult.refundTransactionId,
  };
}

export async function reconcileUnknownSumUpRefundAttempt({
  refundRequestId,
  adminUserId,
  claimAttempt = claimUnknownSumUpRefundAttemptForReconciliation,
  getLatestAttempt = getLatestSumUpRefundAttemptForRequest,
  updateAttemptStatus = updateSumUpRefundAttemptStatus,
  restoreRefundRequestToPending = restoreRefundRequestToPendingAfterFailedSumUpAttempt,
  completeRefundRequest = completeWalletRefundRequest,
  retrieveEvidence = retrieveSumUpRefundEvidenceForAttempt,
}: ReconcileUnknownSumUpRefundAttemptParams): Promise<SumUpRefundReconciliationResult> {
  const claimedAttempt = await claimAttempt({ refundRequestId, adminUserId });

  if (!claimedAttempt) {
    const latestAttempt = await getLatestAttempt(refundRequestId);

    if (latestAttempt?.status === "succeeded") {
      return {
        status: 200,
        result: "already_completed",
        message: "This SumUp refund attempt was already reconciled as succeeded.",
        attemptId: latestAttempt.id,
        refundRequestId,
      };
    }

    return {
      status: 409,
      result: latestAttempt?.status === "processing" ? "still_unknown" : "manual_review",
      message:
        latestAttempt?.status === "processing"
          ? "A SumUp refund attempt is already being processed or reconciled."
          : "No unknown SumUp refund attempt is available to reconcile.",
      attemptId: latestAttempt?.id ?? null,
      refundRequestId,
    };
  }

  let evidenceResult: SumUpRefundEvidenceResult;

  try {
    evidenceResult = await retrieveEvidence(claimedAttempt);
  } catch (error) {
    evidenceResult = {
      outcome: "manual_review",
      message: "Unable to retrieve SumUp reconciliation evidence. Manual review is required.",
      evidence: {
        source: "sumup_transaction_lookup",
        reason: error instanceof Error ? error.message.slice(0, 120) : "lookup_failed",
      },
    };
  }

  const metadata = getReconciliationMetadata(evidenceResult, adminUserId);

  if (evidenceResult.outcome === "refund_confirmed") {
    const updatedAttempt = await updateAttemptStatus({
      attemptId: claimedAttempt.id,
      refundRequestId,
      status: "succeeded",
      errorMessage: null,
      sumUpResponse: getSafeResponse(evidenceResult),
      metadata,
    });

    if (!updatedAttempt) {
      return {
        status: 409,
        result: "manual_review",
        message: "SumUp refund was confirmed, but the local attempt could not be updated.",
        attemptId: claimedAttempt.id,
        refundRequestId,
      };
    }

    const completionResult = await completeRefundRequest({
      refundRequestId,
      adminUserId,
      idempotencyKey: `refund_completed:sumup_attempt:${claimedAttempt.id}`,
      description: "Refund completed via SumUp",
      metadata: {
        sumup_refund_attempt_id: claimedAttempt.id,
        sumup_refund_reconciliation: true,
        sumup_refund_reconciliation_result: evidenceResult.outcome,
      },
      completionSource: "automatic_sumup",
    });

    if (!completionResult.success) {
      warnUnknownOrManualReview(
        {
          ...evidenceResult,
          outcome: "manual_review",
          message: "SumUp refund was confirmed, but wallet completion failed.",
        },
        claimedAttempt,
        refundRequestId
      );

      return {
        status: 409,
        result: "manual_review",
        message: "SumUp refund was confirmed, but wallet completion needs manual review.",
        attemptId: claimedAttempt.id,
        refundRequestId,
      };
    }

    return completedResult(refundRequestId, claimedAttempt, completionResult);
  }

  if (evidenceResult.outcome === "not_refunded_retry_allowed") {
    const updatedAttempt = await updateAttemptStatus({
      attemptId: claimedAttempt.id,
      refundRequestId,
      status: "failed",
      errorMessage: evidenceResult.message,
      sumUpResponse: getSafeResponse(evidenceResult),
      metadata,
    });

    if (!updatedAttempt) {
      return {
        status: 409,
        result: "manual_review",
        message: "SumUp no-refund evidence was found, but the local attempt could not be updated.",
        attemptId: claimedAttempt.id,
        refundRequestId,
      };
    }

    await restoreRefundRequestToPending({
      refundRequestId,
      attemptId: claimedAttempt.id,
    });

    return {
      status: 200,
      result: "not_refunded_retry_allowed",
      message: evidenceResult.message,
      attemptId: claimedAttempt.id,
      refundRequestId,
    };
  }

  const updatedAttempt = await updateAttemptStatus({
    attemptId: claimedAttempt.id,
    refundRequestId,
    status: "unknown",
    errorMessage: evidenceResult.message,
    sumUpResponse: getSafeResponse(evidenceResult),
    metadata,
  });

  if (!updatedAttempt) {
    return {
      status: 409,
      result: "manual_review",
      message: "SumUp evidence was inconclusive, but the local attempt could not be updated.",
      attemptId: claimedAttempt.id,
      refundRequestId,
    };
  }

  warnUnknownOrManualReview(evidenceResult, claimedAttempt, refundRequestId);

  return {
    status: evidenceResult.outcome === "manual_review" ? 409 : 200,
    result: evidenceResult.outcome,
    message: evidenceResult.message,
    attemptId: claimedAttempt.id,
    refundRequestId,
  };
}
