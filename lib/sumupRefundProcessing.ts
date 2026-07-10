import "server-only";

import {
  claimSumUpRefundAttempt,
  completeWalletRefundRequest,
  restoreRefundRequestToPendingAfterFailedSumUpAttempt,
  updateSumUpRefundAttemptStatus,
  type ClaimSumUpRefundAttemptResult,
  type CompleteWalletRefundRequestResult,
} from "@/lib/wallet";

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

function assertClaimHasRequiredFields(claimResult: ClaimSumUpRefundAttemptResult) {
  if (!claimResult.attemptId || !claimResult.refundRequestId) {
    return "SumUp refund claim did not return an attempt.";
  }

  if (!claimResult.sumUpTransactionId?.trim()) {
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
  skippedSumUpRefundCall: boolean
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
      sumup_transaction_id: claimResult.sumUpTransactionId,
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

export async function processAutomaticSumUpRefund({
  refundRequestId,
  adminUserId,
  refundDependency,
  claimAttempt = claimSumUpRefundAttempt,
  completeRefundRequest = completeWalletRefundRequest,
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

  const requiredFieldsError = assertClaimHasRequiredFields(claimResult);

  if (requiredFieldsError) {
    return {
      outcome: "blocked",
      status: 409,
      error: requiredFieldsError,
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
        true
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

  const refundResult = await refundDependency({
    transactionId: claimResult.sumUpTransactionId!,
    amount: claimResult.amount,
  });

  if (refundResult.outcome === "failed") {
    const updatedAttempt = await updateAttemptStatus({
      attemptId: claimResult.attemptId!,
      refundRequestId: claimResult.refundRequestId!,
      status: "failed",
      errorMessage: refundResult.errorMessage,
      sumUpResponse: refundResult.response ?? null,
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
      sumUpResponse: refundResult.response ?? null,
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
    sumUpResponse: refundResult.response ?? null,
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
    false
  );
}
