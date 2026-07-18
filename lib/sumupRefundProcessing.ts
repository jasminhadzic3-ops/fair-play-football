import "server-only";

import * as Sentry from "@sentry/nextjs";
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
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RefundDependencyParams = {
  transactionId: string;
  amount: number;
  originalPaymentAmount: number;
  currency: string | null;
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
  actorUserId: string;
  initiatedBy: "admin" | "player";
  refundDependency: SumUpRefundDependency;
  claimAttempt?: typeof claimSumUpRefundAttempt;
  completeRefundRequest?: typeof completeWalletRefundRequest;
  resolveTransactionId?: typeof resolveAndStoreSumUpTransactionIdForPaymentId;
  persistTransactionIdForAttempt?: typeof persistSumUpTransactionIdForProcessingAttempt;
  updateAttemptStatus?: typeof updateSumUpRefundAttemptStatus;
  restoreRefundRequestToPending?: typeof restoreRefundRequestToPendingAfterFailedSumUpAttempt;
  loadOriginalPayment?: typeof loadOriginalPaymentForRefundAttempt;
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
      diagnosticCode: string;
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
  actorUserId: string,
  initiatedBy: "admin" | "player",
  completeRefundRequest: typeof completeWalletRefundRequest,
  skippedSumUpRefundCall: boolean,
  sumUpTransactionId: string | null
) {
  const completionResult = await completeRefundRequest({
    refundRequestId: claimResult.refundRequestId!,
    adminUserId: actorUserId,
    idempotencyKey: `refund_completed:sumup_attempt:${claimResult.attemptId}`,
    description: "SumUp refund completed",
    adminNote: "Completed via SumUp",
    completionSource: "automatic_sumup",
    metadata: {
      refund_request_id: claimResult.refundRequestId,
      processed_by: actorUserId,
      initiated_by_user_id: actorUserId,
      initiated_by_role: initiatedBy,
      refund_initiation_source:
        initiatedBy === "player" ? "player_refund_request" : "admin_refund_request",
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
    upstream_http_status: safeNumber(response.upstream_http_status ?? response.http_status),
    endpoint_family: safeString(response.endpoint_family, 120),
    response_body_kind: safeString(response.response_body_kind, 40),
    problem_type: safeString(response.problem_type ?? response.type, 300),
    title: safeString(response.title),
    detail: safeString(response.detail, 500),
    error_code: safeString(response.error_code),
    code: safeString(response.code),
    safe_message: safeString(response.safe_message ?? response.message ?? response.error_message),
    error_message: safeString(response.error_message),
    message: safeString(response.message),
  };
}

function getSumUpDiagnosticCode(response: Record<string, unknown> | null | undefined) {
  const safeResponse = safeSumUpResponse(response);
  const status = safeResponse?.upstream_http_status;
  const rawReason =
    safeResponse?.error_code ??
    safeResponse?.code ??
    safeResponse?.title ??
    safeResponse?.response_body_kind ??
    "unknown";
  const reason = rawReason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return `sumup_refund_${status ?? "unknown"}_${reason || "unknown"}`;
}

function getFailureMetadata(response: Record<string, unknown> | null | undefined) {
  const safeResponse = safeSumUpResponse(response);

  return {
    sumup_refund_diagnostic_code: getSumUpDiagnosticCode(response),
    sumup_refund_upstream_http_status: safeResponse?.upstream_http_status ?? null,
    sumup_refund_endpoint_family: safeResponse?.endpoint_family ?? null,
    sumup_refund_response_body_kind: safeResponse?.response_body_kind ?? null,
  };
}

async function loadOriginalPaymentForRefundAttempt(bookingPaymentId: number | null) {
  if (!bookingPaymentId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("booking_payments")
    .select("amount,currency,payment_status")
    .eq("id", bookingPaymentId)
    .maybeSingle<{
      amount: number | string | null;
      currency: string | null;
      payment_status: string | null;
    }>();

  if (error) {
    throw error;
  }

  if (!data || data.payment_status !== "paid") {
    return null;
  }

  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    amount,
    currency: data.currency,
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
  actorUserId,
  initiatedBy,
  refundDependency,
  claimAttempt = claimSumUpRefundAttempt,
  completeRefundRequest = completeWalletRefundRequest,
  resolveTransactionId = resolveAndStoreSumUpTransactionIdForPaymentId,
  persistTransactionIdForAttempt = persistSumUpTransactionIdForProcessingAttempt,
  updateAttemptStatus = updateSumUpRefundAttemptStatus,
  restoreRefundRequestToPending = restoreRefundRequestToPendingAfterFailedSumUpAttempt,
  loadOriginalPayment = loadOriginalPaymentForRefundAttempt,
}: ProcessAutomaticSumUpRefundParams): Promise<ProcessAutomaticSumUpRefundResult> {
  const claimResult = await claimAttempt({
    refundRequestId,
    adminUserId: actorUserId,
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
        actorUserId,
        initiatedBy,
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

  let originalPayment: Awaited<ReturnType<typeof loadOriginalPaymentForRefundAttempt>>;

  try {
    originalPayment = await loadOriginalPayment(claimResult.bookingPaymentId);
  } catch (error) {
    return {
      outcome: "blocked",
      status: 409,
      error: error instanceof Error ? error.message : "Unable to load original SumUp payment.",
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  if (!originalPayment) {
    return {
      outcome: "blocked",
      status: 409,
      error: "Refund request is not linked to a paid SumUp payment amount.",
      attemptStatus: claimResult.attemptStatus,
      attemptId: claimResult.attemptId,
    };
  }

  const refundResult = await refundDependency({
    transactionId: resolvedTransaction.sumUpTransactionId,
    amount: claimResult.amount,
    originalPaymentAmount: originalPayment.amount,
    currency: originalPayment.currency,
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
        initiated_by_user_id: actorUserId,
        initiated_by_role: initiatedBy,
        refund_initiation_source:
          initiatedBy === "player" ? "player_refund_request" : "admin_refund_request",
        ...getFailureMetadata(refundResult.response),
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
      diagnosticCode: getSumUpDiagnosticCode(refundResult.response),
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
        initiated_by_user_id: actorUserId,
        initiated_by_role: initiatedBy,
        refund_initiation_source:
          initiatedBy === "player" ? "player_refund_request" : "admin_refund_request",
        ...getFailureMetadata(refundResult.response),
      },
    });

    Sentry.captureMessage("SumUp refund outcome is unknown", {
      level: "warning",
      tags: {
        area: "sumup_refunds",
        outcome: "unknown",
      },
      extra: {
        refund_request_id: claimResult.refundRequestId,
        sumup_refund_attempt_id: claimResult.attemptId,
        error_message: safeString(refundResult.errorMessage),
      },
    });

    return {
      outcome: "sumup_unknown",
      status: 502,
      error: "SumUp refund outcome is unknown. Reconcile manually before retrying.",
      diagnosticCode: getSumUpDiagnosticCode(refundResult.response),
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
      initiated_by_user_id: actorUserId,
      initiated_by_role: initiatedBy,
      refund_initiation_source:
        initiatedBy === "player" ? "player_refund_request" : "admin_refund_request",
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
    actorUserId,
    initiatedBy,
    completeRefundRequest,
    false,
    resolvedTransaction.sumUpTransactionId
  );
}
