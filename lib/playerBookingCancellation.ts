import "server-only";

import {
  sendPlayerBookingCancelledEmail,
  type PlayerBookingCancellationEmailOutcome,
} from "@/lib/email/playerBookingCancelled";
import { createWalletCreditNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  {
    status: "not_applicable";
    message: string;
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

type PlayerBookingCancellationRow = {
  id: number;
};

type PlayerBookingCancellationFallbackRow = {
  booking_id: number;
  game_id: number;
  payment_method: "sumup" | "wallet" | "legacy";
  refund_policy: "eligible_24h" | "ineligible_within_24h" | "support_required";
  status: string | null;
  source_credit_transaction_id: number | null;
  refund_request_id: number | null;
  wallet_transaction_id: number | null;
  amount: number | string | null;
  currency: string | null;
  reason: string | null;
  was_full_before_release: boolean | null;
  space_available_after_release: boolean | null;
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

function automaticRefundNotApplicable(message: string): AutomaticCancellationRefund {
  return {
    status: "not_applicable",
    message,
  };
}

function responseFromRpcResult(
  result: PlayerBookingCancellationRpcResult,
  automaticRefund: AutomaticCancellationRefund
): PlayerBookingCancellationResult {
  const amount = toNumber(result.amount);
  const baseMessage =
    result.refund_policy === "eligible_24h" &&
    (result.payment_method === "wallet" || result.payment_method === "sumup")
      ? amount === null
        ? "Booking Cancelled\n\nCredit has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet."
        : `Booking Cancelled\n\n${formatCancellationAmount(amount, result.currency)} has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.`
      : result.refund_policy === "ineligible_within_24h"
        ? "Booking cancelled. No refund is available within 24 hours of kick-off."
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

function formatCancellationAmount(amount: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
    }).format(amount);
  } catch {
    return `${currency || "GBP"} ${amount.toFixed(2)}`;
  }
}

function getCancellationEmailOutcome(
  result: PlayerBookingCancellationResult
): PlayerBookingCancellationEmailOutcome | null {
  if (!result.released) {
    return null;
  }

  if (result.refundPolicy === "ineligible_within_24h") {
    return "no_refund_within_24h";
  }

  if (
    result.refundPolicy === "eligible_24h" &&
    (result.paymentMethod === "wallet" || result.paymentMethod === "sumup")
  ) {
    return "wallet_restored";
  }

  return null;
}

async function loadCancellationId(bookingId: number, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("player_booking_cancellations")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("user_id", userId)
    .maybeSingle<PlayerBookingCancellationRow>();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

async function loadReleasedCancellationFallback(bookingId: number, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("player_booking_cancellations")
    .select(
      "booking_id,game_id,payment_method,refund_policy,status,source_credit_transaction_id,refund_request_id,wallet_transaction_id,amount,currency,reason,was_full_before_release,space_available_after_release"
    )
    .eq("booking_id", bookingId)
    .eq("user_id", userId)
    .maybeSingle<PlayerBookingCancellationFallbackRow>();

  if (error) {
    throw error;
  }

  if (!data || data.status !== "released") {
    return null;
  }

  return responseFromRpcResult(
    {
      success: true,
      booking_id: data.booking_id,
      game_id: data.game_id,
      released: true,
      refund_eligible: data.refund_policy === "eligible_24h",
      payment_method: data.payment_method,
      refund_policy: data.refund_policy,
      source_credit_transaction_id: data.source_credit_transaction_id,
      refund_request_id: data.refund_request_id,
      wallet_restoration_transaction_id:
        data.payment_method === "wallet" ? data.source_credit_transaction_id : data.wallet_transaction_id,
      amount: data.amount,
      currency: data.currency,
      reason: data.reason,
      was_full_before_release: data.was_full_before_release,
      space_available_after_release: data.space_available_after_release,
    },
    automaticRefundNotApplicable(
      data.refund_policy === "ineligible_within_24h"
        ? "No refund is available within 24 hours of kick-off."
        : "Wallet credit added. You can request a refund from your Wallet."
    )
  );
}

async function sendCancellationEmailAfterRelease(
  result: PlayerBookingCancellationResult,
  userId: string
) {
  const outcome = getCancellationEmailOutcome(result);

  if (!outcome || !result.bookingId || !result.gameId) {
    return;
  }

  const cancellationId = await loadCancellationId(result.bookingId, userId);

  if (!cancellationId) {
    throw new Error("Unable to send cancellation email: cancellation record not found.");
  }

  await sendPlayerBookingCancelledEmail({
    cancellationId,
    bookingId: result.bookingId,
    gameId: result.gameId,
    userId,
    outcome,
    amount: result.amount,
    currency: result.currency,
  });

  if (outcome === "wallet_restored" && result.sourceCreditTransactionId && result.amount) {
    await createWalletCreditNotification({
      userId,
      walletTransactionId: result.sourceCreditTransactionId,
      amount: result.amount,
      reason: "Player cancellation",
      gameId: result.gameId,
    }).catch((notificationError) => {
      console.error("Unable to create player cancellation wallet notification:", {
        bookingId: result.bookingId,
        gameId: result.gameId,
        userId,
        walletTransactionId: result.sourceCreditTransactionId,
        error: notificationError,
      });
    });
  }
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
    if (rpcResult.reason === "booking_not_found") {
      const fallbackResult = await loadReleasedCancellationFallback(bookingId, userId);

      if (fallbackResult) {
        return fallbackResult;
      }
    }

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

  const automaticRefund: AutomaticCancellationRefund = automaticRefundNotApplicable(
    rpcResult.refund_policy === "ineligible_within_24h"
      ? "No refund is available within 24 hours of kick-off."
      : "Wallet credit added. You can request a refund from your Wallet."
  );

  const result = responseFromRpcResult(rpcResult, automaticRefund);

  await sendCancellationEmailAfterRelease(result, userId).catch((emailError) => {
    console.error("Unable to send player booking cancellation email:", {
      bookingId: result.bookingId,
      gameId: result.gameId,
      userId,
      reason: result.reason,
      automaticRefundStatus: result.automaticRefund.status,
      error: emailError,
    });
  });

  return result;
}
