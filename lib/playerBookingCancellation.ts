import "server-only";

import { getAutomaticRefundDependency } from "@/lib/sumupRefundDependencies";
import { processAutomaticSumUpRefund } from "@/lib/sumupRefundProcessing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLatestSumUpRefundAttemptForRequest } from "@/lib/wallet";

const failedAutomaticRefundRetryCooldownMs = 60 * 1000;

export type PlayerBookingCancellationRpcResult = {
  success: boolean | null;
  booking_id: number | null;
  game_id: number | null;
  released: boolean | null;
  refund_eligible: boolean | null;
  payment_method: "sumup" | "wallet" | "legacy" | null;
  refund_policy: "eligible_24h" | "ineligible_within_24h" | "support_required" | null;
  source_credit_transaction_id: number | null;
  refund_request_id: number | null;
  wallet_restoration_transaction_id: number | null;
  amount: number | string | null;
  currency: string | null;
  reason: string | null;
  was_full_before_release: boolean | null;
  space_available_after_release: boolean | null;
};

export type AutomaticCancellationRefund =
  | {
      status: "not_applicable" | "disabled" | "cooling_down";
      message: string;
    }
  | {
      status: "completed";
      message: string;
      refund_transaction_id: number | null;
      sumup_refund_attempt_id: number;
      skipped_sumup_refund_call: boolean;
    }
  | {
      status: "failed" | "manual_review" | "processing";
      message: string;
      diagnostic_code?: string;
      sumup_refund_attempt_id?: number | null;
    };

export type PlayerBookingCancellationResult = {
  success: boolean;
  status: number;
  message: string;
  bookingId: number | null;
  gameId: number | null;
  released: boolean;
  refundEligible: boolean;
  paymentMethod: "sumup" | "wallet" | "legacy" | null;
  refundPolicy: "eligible_24h" | "ineligible_within_24h" | "support_required" | null;
  sourceCreditTransactionId: number | null;
  refundRequestId: number | null;
  walletRestorationTransactionId: number | null;
  amount: number | null;
  currency: string | null;
  reason: string | null;
  shouldNotifyWaitingList: boolean;
  automaticRefund: AutomaticCancellationRefund;
};

function toNumber(value: number | string | null) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getStatusForReason(reason: string | null) {
  switch (reason) {
    case "invalid_booking":
    case "invalid_user":
      return 400;
    case "booking_not_found":
      return 404;
    case "missing_starts_at":
    case "booking_has_no_refundable_payment_source":
    case "booking_has_ambiguous_payment_history":
      return 409;
    default:
      return 500;
  }
}

function getMessageForReason(reason: string | null) {
  switch (reason) {
    case "missing_starts_at":
      return "This booking needs support to cancel because the kickoff time is not fully confirmed. Please contact Fair Play Football.";
    case "booking_has_ambiguous_payment_history":
      return "This booking needs support to cancel because its payment history needs review.";
    case "booking_has_no_refundable_payment_source":
      return "This booking needs support to cancel because no refundable payment record was found.";
    case "booking_not_found":
      return "Booking not found.";
    case "invalid_booking":
      return "Invalid booking.";
    default:
      return "Unable to cancel this booking. Please contact Fair Play Football.";
  }
}

function automaticRefundDisabled(): AutomaticCancellationRefund {
  return {
    status: "disabled",
    message: "Card refund requested and reserved; awaiting processing.",
  };
}

function automaticRefundNotApplicable(message: string): AutomaticCancellationRefund {
  return {
    status: "not_applicable",
    message,
  };
}

function automaticRefundCoolingDown(): AutomaticCancellationRefund {
  return {
    status: "cooling_down",
    message: "Card refund could not complete. Please wait before trying again or contact support.",
  };
}

function automaticRefundFromProcessorResult(
  result: Awaited<ReturnType<typeof processAutomaticSumUpRefund>>
): AutomaticCancellationRefund {
  if (result.outcome === "completed") {
    return {
      status: "completed",
      message: "Booking cancelled and card refund completed.",
      refund_transaction_id: result.refundTransactionId,
      sumup_refund_attempt_id: result.attemptId,
      skipped_sumup_refund_call: result.skippedSumUpRefundCall,
    };
  }

  if (result.outcome === "sumup_unknown") {
    return {
      status: "manual_review",
      message: "Booking cancelled. Your card refund needs review and remains reserved.",
      diagnostic_code: result.diagnosticCode,
      sumup_refund_attempt_id: result.attemptId,
    };
  }

  if (result.outcome === "sumup_failed") {
    return {
      status: "failed",
      message: "Booking cancelled. The automatic card refund could not complete; your refund remains reserved for support.",
      diagnostic_code: result.diagnosticCode,
      sumup_refund_attempt_id: result.attemptId,
    };
  }

  if (result.outcome === "blocked") {
    return {
      status: result.attemptStatus === "unknown" ? "manual_review" : "processing",
      message:
        result.attemptStatus === "unknown"
          ? "Booking cancelled. Your card refund needs review and remains reserved."
          : "Booking cancelled. Your card refund is processing.",
      sumup_refund_attempt_id: result.attemptId,
    };
  }

  return {
    status: "failed",
    message: "Booking cancelled. Card refund processing is unavailable; your refund remains reserved.",
  };
}

async function isRecentFailedAttemptCoolingDown(refundRequestId: number) {
  const latestAttempt = await getLatestSumUpRefundAttemptForRequest(refundRequestId);

  if (latestAttempt?.status !== "failed") {
    return false;
  }

  const updatedAt = Date.parse(latestAttempt.updated_at || latestAttempt.created_at);

  return Number.isFinite(updatedAt) && Date.now() - updatedAt < failedAutomaticRefundRetryCooldownMs;
}

function responseFromRpcResult(
  result: PlayerBookingCancellationRpcResult,
  automaticRefund: AutomaticCancellationRefund
): PlayerBookingCancellationResult {
  const amount = toNumber(result.amount);
  const baseMessage =
    result.payment_method === "wallet" && result.refund_policy === "eligible_24h"
      ? "Booking cancelled and wallet credit restored."
      : result.refund_policy === "ineligible_within_24h"
        ? "Booking cancelled. No refund is available within 24 hours of kick-off."
        : result.payment_method === "sumup" && result.refund_policy === "eligible_24h"
          ? automaticRefund.message
          : "Booking cancelled.";

  return {
    success: true,
    status: 200,
    message: baseMessage,
    bookingId: result.booking_id,
    gameId: result.game_id,
    released: Boolean(result.released),
    refundEligible: Boolean(result.refund_eligible),
    paymentMethod: result.payment_method,
    refundPolicy: result.refund_policy,
    sourceCreditTransactionId: result.source_credit_transaction_id,
    refundRequestId: result.refund_request_id,
    walletRestorationTransactionId: result.wallet_restoration_transaction_id,
    amount,
    currency: result.currency,
    reason: result.reason,
    shouldNotifyWaitingList: Boolean(result.space_available_after_release),
    automaticRefund,
  };
}

export async function cancelPlayerBookingWithRefundPolicy({
  bookingId,
  userId,
}: {
  bookingId: number;
  userId: string;
}): Promise<PlayerBookingCancellationResult> {
  const { data, error } = await supabaseAdmin.rpc("cancel_player_booking_with_refund_policy", {
    p_booking_id: bookingId,
    p_user_id: userId,
  });

  if (error) {
    throw error;
  }

  const rpcResult = (Array.isArray(data) ? data[0] : data) as PlayerBookingCancellationRpcResult | null;

  if (!rpcResult) {
    throw new Error("Booking cancellation did not return a result.");
  }

  if (!rpcResult.success) {
    return {
      success: false,
      status: getStatusForReason(rpcResult.reason),
      message: getMessageForReason(rpcResult.reason),
      bookingId: rpcResult.booking_id,
      gameId: rpcResult.game_id,
      released: false,
      refundEligible: false,
      paymentMethod: rpcResult.payment_method,
      refundPolicy: rpcResult.refund_policy,
      sourceCreditTransactionId: null,
      refundRequestId: null,
      walletRestorationTransactionId: null,
      amount: toNumber(rpcResult.amount),
      currency: rpcResult.currency,
      reason: rpcResult.reason,
      shouldNotifyWaitingList: false,
      automaticRefund: automaticRefundNotApplicable(getMessageForReason(rpcResult.reason)),
    };
  }

  let automaticRefund: AutomaticCancellationRefund = automaticRefundNotApplicable(
    rpcResult.refund_policy === "ineligible_within_24h"
      ? "No refund is available within 24 hours of kick-off."
      : "No card refund is required."
  );

  if (
    rpcResult.payment_method === "sumup" &&
    rpcResult.refund_policy === "eligible_24h" &&
    rpcResult.refund_request_id
  ) {
    const refundDependency = getAutomaticRefundDependency();

    if (!refundDependency) {
      automaticRefund = automaticRefundDisabled();
    } else if (await isRecentFailedAttemptCoolingDown(rpcResult.refund_request_id)) {
      automaticRefund = automaticRefundCoolingDown();
    } else {
      const processorResult = await processAutomaticSumUpRefund({
        refundRequestId: rpcResult.refund_request_id,
        actorUserId: userId,
        initiatedBy: "player",
        refundDependency,
      });

      automaticRefund = automaticRefundFromProcessorResult(processorResult);
    }
  }

  return responseFromRpcResult(rpcResult, automaticRefund);
}
