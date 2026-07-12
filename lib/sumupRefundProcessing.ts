import "server-only";

import {
  claimSumUpRefundAttempt,
  completeWalletRefundRequest,
  persistSumUpTransactionIdForProcessingAttempt,
  restoreRefundRequestToPendingAfterFailedSumUpAttempt,
  updateSumUpRefundAttemptStatus,
  type ClaimSumUpRefundAttemptResult,
  type CompleteWalletRefundRequestResult,
} from "@/lib/wallet";
import { resolveAndStoreSumUpTransactionIdForPaymentId } from "@/lib/sumupPayments";

type RefundDependencyParams = {
  transactionId: string;
  amount: number;
};

export type SumUpRefundDependencyResult =
  | {
      outcome: "succeeded";
      response: Record<string, unknown> | null;
    }
  | {
      outcome: "failed";
      errorMessage: string;
      response?: Record<string, unknown> | null;
    }
  | {
      outcome: "unknown";
      errorMessage: string;
      response?: Record<string, unknown> | null;
    };

export type SumUpRefundDependency = (
  params: RefundDependencyParams
) => Promise<SumUpRefundDependencyResult>;

export type ProcessAutomaticSumUpRefundParams = {
  refundRequestId: number;
  adminUserId: string;
  refundDependency: SumUpRefundDependency;
  claimAttempt?: typeof claimSumUpRefundAttempt;
  completeRefundRequest?: typeof completeWalletRefundRequest;
  resolveTransactionId?: typeof resolveAndStoreSumUpTransactionIdForPaymentId;
  persistTransactionIdForAttempt?: typeof persistSumUpTransactionIdForProcessingAttempt;
  updateAttemptStatus?: typeof updateSumUpRefundAttemptStatus;
  restoreRefundRequestToPending?: typeof restoreRefundRequestToPendingAfterFailedSumUpAttempt;
};

export type ProcessAutomaticSumUpRefundResult =
  | {
      outcome: "claim_failed";
      status: number;
      error: string;
      reason: string | null;
    }
  | {
      outcome: "blocked";
      status: number;
      error: string;
      attemptStatus: string | null;
      attemptId: number | null;
    }
  | {
      outcome: "sumup_failed" | "sumup_unknown";
      status: number;
      error: string;
      attemptId: number;
      refundRequestId: number;
    }
  | {
      outcome: "wallet_completion_failed";
      status: number;
      error: string;
      attemptId: number;
      refundRequestId: number;
    }
  | {
      outcome: "completed";
      status: number;
      message: string;
      attemptId: number;
      refundRequestId: number;
      refundTransactionId: number | null;
      balanceBreakdown: {
        completedBalance: number;
        reservedRefundAmount: number;
        availableBalance: number;
      };
      skippedSumUpRefundCall: boolean;
    };

function getStatusForClaimReason(reason: string | null) {
  switch (reason) {
    case "refund_request_not_found":
      return 404;
    case "invalid_refund_request_status":
      return 409;
    case "invalid_refund_request":
    case "invalid_admin_user":
    case "automatic_refund_not_allowed":
    case "invalid_source_credit":
    case "invalid_booking_payment":
    case "missing_sumup_transaction_reference":
    case "invalid_refund_amount":
      return 400;
    default:
      return 500;
  }
}

function getMessageForClaimReason(reason: string | null) {
  switch (reason) {
    case "invalid_refund_request_status":
      return "Refund request is not pending or processing.";
    case "refund_request_not_found":
      return "Refund request not found.";
    case "automatic_refund_not_allowed":
      return "This refund request is not eligible for SumUp automatic refund.";
    case "invalid_booking_payment":
      return "Refund request is not linked to a valid SumUp payment.";
    case "missing_sumup_transaction_reference":
      return "Refund request is missing a SumUp transaction reference.";
    case "invalid_source_credit":
      return "Refund request is not linked to a valid source credit.";
    case "invalid_refund_amount":
      return "Invalid refund request amount.";
    default:
      return "Unable to claim SumUp refund attempt.";
  }
}

function assertClaimHasRequiredFields(
  claimResult: ClaimSumUpRefundAttemptResult,
  sumUpTransactionId: string | null
) {
  if (!claimResult.attemptId || !claimResult.refundRequestId) {
    return "SumUp refund claim did not return an attempt.";
  }

  if (!sumUpTransactionId?.trim()) {
    return "Refund request is missing a resolved SumUp transaction id.";
  }

  if (!Number.isFinite(claimResult.amount) || claimResult.amount <= 0) {
    return "Invalid SumUp refund amount.";
  }

  return null;
}

function completionResponse(
  claimResult: ClaimSumUpRefundAttemptResult,
  completionResult: CompleteWalletRefundRequestResult,
  skippedSumUpRefundCall: boolean
): ProcessAutomaticSumUpRefundResult {
  return {
    outcome: "completed",
    status: 200,
    message: skippedSumUpRefundCall
      ? "SumUp refund had already succeeded. Wallet completion was retried without another SumUp call."
      : "SumUp refund completed and wallet balance was updated.",
    attemptId: claimResult.attemptId!,
    refundRequestId: claimResult.refundRequestId!,
    refundTransactionId: completionResult.refundTransactionId,
    balanceBreakdown: {
      completedBalance: completionResult.completedBalance,
      reservedRefundAmount: completionResult.reservedRefundAmount,
      availableBalance: completionResult.availableBalance,
    },
    skippedSumUpRefundCall,
  };
}

async function completeSucceededAttempt(
  claimResult: ClaimSumUpRefundAttemptResult,
  adminUserId: string,
  completeRefundRequest: typeof completeWalletRefundRequest,
  skippedSumUpRefundCall: boolean,
  sumUpTransactionId: string | null
) {
  const completionResult = await completeRefundRequest({
    refundRequestId: claimResult.refundRequestId!,
    adminUserId,
    idempotencyKey: `refund_completed:sumup_attempt:${claimResult.attemptId}`,
    description: "SumUp refund completed",
    adminNote: "Completed via SumUp",
    metadata: {
      refund_request_id: claimResult.refundRequestId,
      processed_by: adminUserId,
      automatic_sumup_refund: true,
      refund_channel: "sumup",
      sumup_refund_attempt_id: claimResult.attemptId,
      sumup_transaction_id: sumUpTransactionId,
    },
  });

  if (!completionResult.success) {
    return {
      outcome: "wallet_completion_failed",
      status: 409,
      error: "SumUp refund succeeded, but wallet completion did not finish. Retry wallet completion only.",
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
    } satisfies ProcessAutomaticSumUpRefundResult;
  }

  return completionResponse(claimResult, completionResult, skippedSumUpRefundCall);
}

function safeString(value: unknown, maxLength = 300) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue.slice(0, maxLength) : null;
}

function safeNumber(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeSumUpResponse(response: Record<string, unknown> | null | undefined) {
  if (!response) {
    return null;
  }

  return {
    id: safeString(response.id),
    status: safeString(response.status),
    amount: safeNumber(response.amount),
    currency: safeString(response.currency, 20),
    transaction_id: safeString(response.transaction_id),
    error_code: safeString(response.error_code),
    error_message: safeString(response.error_message),
    message: safeString(response.message),
  };
}

async function resolveMissingTransactionIdForNewAttempt({
  claimResult,
  resolveTransactionId,
  persistTransactionIdForAttempt,
}: {
  claimResult: ClaimSumUpRefundAttemptResult;
  resolveTransactionId: typeof resolveAndStoreSumUpTransactionIdForPaymentId;
  persistTransactionIdForAttempt: typeof persistSumUpTransactionIdForProcessingAttempt;
}) {
  const existingTransactionId = claimResult.sumUpTransactionId?.trim();

  if (existingTransactionId) {
    return {
      success: true as const,
      sumUpTransactionId: existingTransactionId,
    };
  }

  if (!claimResult.bookingPaymentId) {
    return {
      success: false as const,
      error: "Refund request is not linked to a booking payment for transaction lookup.",
    };
  }

  let resolvedTransactionId: string | null;

  try {
    resolvedTransactionId = await resolveTransactionId(claimResult.bookingPaymentId);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Unable to resolve SumUp transaction id.",
    };
  }

  if (!resolvedTransactionId?.trim()) {
    return {
      success: false as const,
      error: "Unable to resolve SumUp transaction id for this refund.",
    };
  }

  const updatedAttempt = await persistTransactionIdForAttempt({
    attemptId: claimResult.attemptId!,
    refundRequestId: claimResult.refundRequestId!,
    sumUpTransactionId: resolvedTransactionId,
  });

  if (!updatedAttempt) {
    return {
      success: false as const,
      error: "SumUp refund attempt state changed before transaction id persistence.",
    };
  }

  return {
    success: true as const,
    sumUpTransactionId: resolvedTransactionId,
  };
}

export async function processAutomaticSumUpRefund({
  refundRequestId,
  adminUserId,
  refundDependency,
  claimAttempt = claimSumUpRefundAttempt,
  completeRefundRequest = completeWalletRefundRequest,
  resolveTransactionId = resolveAndStoreSumUpTransactionIdForPaymentId,
  persistTransactionIdForAttempt = persistSumUpTransactionIdForProcessingAttempt,
  updateAttemptStatus = updateSumUpRefundAttemptStatus,
  restoreRefundRequestToPending = restoreRefundRequestToPendingAfterFailedSumUpAttempt,
}: ProcessAutomaticSumUpRefundParams): Promise<ProcessAutomaticSumUpRefundResult> {
  const claimResult = await claimAttempt({
    refundRequestId,
    adminUserId,
  });

  if (!claimResult.success) {
    return {
      outcome: "claim_failed",
      status: getStatusForClaimReason(claimResult.reason),
      error: getMessageForClaimReason(claimResult.reason),
      reason: claimResult.reason,
    };
  }

  const claimedTransactionId = claimResult.sumUpTransactionId?.trim() || null;

  if (!claimResult.attemptId || !claimResult.refundRequestId) {
    return {
      outcome: "blocked",
      status: 409,
      error: "SumUp refund claim did not return an attempt.",
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  if (claimResult.alreadyClaimed) {
    if (claimResult.attemptStatus === "succeeded") {
      return completeSucceededAttempt(
        claimResult,
        adminUserId,
        completeRefundRequest,
        true,
        claimedTransactionId
      );
    }

    return {
      outcome: "blocked",
      status: 409,
      error:
        claimResult.attemptStatus === "unknown"
          ? "SumUp refund outcome is unknown. Reconcile manually before retrying."
          : "A SumUp refund attempt is already processing. No SumUp refund was sent.",
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  const resolvedTransaction = await resolveMissingTransactionIdForNewAttempt({
    claimResult,
    resolveTransactionId,
    persistTransactionIdForAttempt,
  });

  if (!resolvedTransaction.success) {
    return {
      outcome: "blocked",
      status: 409,
      error: resolvedTransaction.error,
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  const requiredFieldsError = assertClaimHasRequiredFields(
    claimResult,
    resolvedTransaction.sumUpTransactionId
  );

  if (requiredFieldsError) {
    return {
      outcome: "blocked",
      status: 409,
      error: requiredFieldsError,
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  const refundResult = await refundDependency({
    transactionId: resolvedTransaction.sumUpTransactionId,
    amount: claimResult.amount,
  });

  if (refundResult.outcome === "failed") {
    const updatedAttempt = await updateAttemptStatus({
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
      status: "failed",
      errorMessage: refundResult.errorMessage,
      sumUpResponse: safeSumUpResponse(refundResult.response),
      metadata: {
        sumup_refund_finished_at: new Date().toISOString(),
        sumup_refund_outcome: "failed",
      },
    });

    if (updatedAttempt) {
      await restoreRefundRequestToPending({
        refundRequestId: claimResult.refundRequestId!,
        attemptId: claimResult.attemptId!,
      });
    }

    return {
      outcome: "sumup_failed",
      status: 502,
      error: "SumUp rejected the refund. No wallet debit was created.",
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
    };
  }

  if (refundResult.outcome === "unknown") {
    await updateAttemptStatus({
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
      status: "unknown",
      errorMessage: refundResult.errorMessage,
      sumUpResponse: safeSumUpResponse(refundResult.response),
      metadata: {
        sumup_refund_finished_at: new Date().toISOString(),
        sumup_refund_outcome: "unknown",
      },
    });

    return {
      outcome: "sumup_unknown",
      status: 502,
      error: "SumUp refund outcome is unknown. Reconcile manually before retrying.",
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
    };
  }

  const updatedAttempt = await updateAttemptStatus({
    attemptId: claimResult.attemptId!,
    refundRequestId: claimResult.refundRequestId!,
    status: "succeeded",
    errorMessage: null,
    sumUpResponse: safeSumUpResponse(refundResult.response),
    metadata: {
      sumup_refund_finished_at: new Date().toISOString(),
      sumup_refund_outcome: "succeeded",
    },
  });

  if (!updatedAttempt) {
    return {
      outcome: "blocked",
      status: 409,
      error: "SumUp refund attempt state changed before completion. No wallet debit was created.",
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  return completeSucceededAttempt(
    claimResult,
    adminUserId,
    completeRefundRequest,
    false,
    resolvedTransaction.sumUpTransactionId
  );
}
