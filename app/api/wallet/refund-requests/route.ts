import { NextRequest } from "next/server";
import { sendWalletRefundEmail, type WalletRefundEmailOutcome } from "@/lib/email/walletRefund";
import { getAutomaticRefundProcessorDependencies } from "@/lib/sumupRefundDependencies";
import { processAutomaticSumUpRefund } from "@/lib/sumupRefundProcessing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { createWalletRefundRequest, getLatestSumUpRefundAttemptForRequest } from "@/lib/wallet";

type RefundRequestPayload = {
  source_wallet_transaction_id?: unknown;
};

type BalanceBreakdownRpcRow = {
  completed_balance?: number | string | null;
  reserved_refund_amount?: number | string | null;
  available_balance?: number | string | null;
};

type RefundRequestEmailRow = {
  id: number;
  user_id: string;
  amount: number | string | null;
  currency: string | null;
};

const failedAutomaticRefundRetryCooldownMs = 60 * 1000;

function parseSourceWalletTransactionId(value: unknown) {
  const sourceWalletTransactionId = Number(value);

  return Number.isInteger(sourceWalletTransactionId) && sourceWalletTransactionId > 0
    ? sourceWalletTransactionId
    : null;
}

function getStatusForRefundRequestReason(reason: string | null) {
  switch (reason) {
    case "source_credit_not_found":
    case "source_credit_not_owned":
      return 404;
    case "invalid_user":
    case "invalid_source_credit":
    case "not_sumup_cancellation_credit":
      return 400;
    case "invalid_source_amount":
    case "insufficient_balance":
    case "idempotency_key_conflict":
      return 409;
    default:
      return 500;
  }
}

function getMessageForRefundRequestReason(reason: string | null) {
  switch (reason) {
    case "source_credit_not_found":
    case "source_credit_not_owned":
      return "Refundable wallet credit not found.";
    case "not_sumup_cancellation_credit":
      return "Only SumUp cancellation credits can be requested for card refund.";
    case "invalid_source_amount":
      return "Refundable wallet credit has an invalid amount.";
    case "insufficient_balance":
      return "Refund amount cannot be greater than your wallet balance.";
    case "idempotency_key_conflict":
      return "This refund request conflicts with an existing wallet transaction.";
    default:
      return "Unable to request refund.";
  }
}

async function getRefundRequestStatus(refundRequestId: number, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("status")
    .eq("id", refundRequestId)
    .eq("user_id", userId)
    .eq("transaction_type", "refund_requested")
    .maybeSingle<{ status: string | null }>();

  if (error) {
    throw error;
  }

  return data?.status ?? null;
}

async function loadRefundRequestEmailRow(refundRequestId: number, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,user_id,amount,currency")
    .eq("id", refundRequestId)
    .eq("user_id", userId)
    .eq("transaction_type", "refund_requested")
    .maybeSingle<RefundRequestEmailRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function sendRefundOutcomeEmail({
  refundRequestId,
  userId,
  outcome,
}: {
  refundRequestId: number | null;
  userId: string;
  outcome: WalletRefundEmailOutcome;
}) {
  if (!refundRequestId) {
    return;
  }

  try {
    const refundRequest = await loadRefundRequestEmailRow(refundRequestId, userId);

    if (!refundRequest) {
      throw new Error("Refund request email row not found.");
    }

    await sendWalletRefundEmail({
      refundRequestId,
      userId: refundRequest.user_id,
      outcome,
      amount: Math.abs(Number(refundRequest.amount ?? 0)),
      currency: refundRequest.currency || "GBP",
    });
  } catch (emailError) {
    console.error("Unable to send wallet refund email:", {
      refundRequestId,
      userId,
      outcome,
      error: emailError,
    });
  }
}

function automaticRefundDisabled() {
  return {
    status: "disabled",
    message: "Refund requested; awaiting processing.",
  };
}

function automaticRefundAlreadyCompleted() {
  return {
    status: "completed",
    message: "Refund completed.",
  };
}

function automaticRefundRetryCoolingDown() {
  return {
    status: "failed",
    message: "Refund could not complete. The funds remain available in your Fair Play Wallet.",
  };
}

function automaticRefundFromProcessorResult(
  result: Awaited<ReturnType<typeof processAutomaticSumUpRefund>>
) {
  if (result.outcome === "completed") {
    return {
      status: "completed",
      message: result.message,
      refund_transaction: result.refundTransactionId
        ? { id: result.refundTransactionId }
        : null,
      sumup_refund_attempt: {
        id: result.attemptId,
        status: "succeeded",
        skipped_sumup_refund_call: result.skippedSumUpRefundCall,
      },
      balance_breakdown: {
        completedBalance: result.balanceBreakdown.completedBalance,
        reservedRefundAmount: result.balanceBreakdown.reservedRefundAmount,
        availableBalance: result.balanceBreakdown.availableBalance,
      },
    };
  }

  if (result.outcome === "sumup_unknown") {
    return {
      status: "manual_review",
      message: "Refund needs review. We will keep this visible while it is checked.",
      diagnostic_code: result.diagnosticCode,
      sumup_refund_attempt: {
        id: result.attemptId,
        status: "unknown",
      },
    };
  }

  if (result.outcome === "sumup_failed") {
    return {
      status: "failed",
      message: "Refund could not complete. The funds remain available in your Fair Play Wallet.",
      diagnostic_code: result.diagnosticCode,
      sumup_refund_attempt: {
        id: result.attemptId,
        status: "failed",
      },
    };
  }

  if (result.outcome === "blocked") {
    const status = result.attemptStatus === "unknown" ? "manual_review" : "processing";

    return {
      status,
      message:
        status === "manual_review"
          ? "Refund needs review. We will keep this visible while it is checked."
          : "Refund processing.",
      sumup_refund_attempt: result.attemptId
        ? {
            id: result.attemptId,
            status: result.attemptStatus,
          }
        : null,
    };
  }

  return {
    status: "failed",
    message: "Refund is unavailable right now. The funds remain available in your Fair Play Wallet.",
    reason: result.outcome === "claim_failed" ? result.reason : undefined,
  };
}

async function releaseFailedRefundRequest(refundRequestId: number, userId: string) {
  const { error: updateError } = await supabaseAdmin
    .from("wallet_transactions")
    .update({
      status: "failed",
    })
    .eq("id", refundRequestId)
    .eq("user_id", userId)
    .eq("transaction_type", "refund_requested")
    .in("status", ["pending", "processing"]);

  if (updateError) {
    throw updateError;
  }

  const { data, error } = await supabaseAdmin.rpc("get_wallet_balance_breakdown", {
    p_user_id: userId,
    p_currency: "GBP",
  });

  if (error) {
    throw error;
  }

  const balanceBreakdown = (Array.isArray(data) ? data[0] : data) as BalanceBreakdownRpcRow | null;

  return {
    completedBalance: Number(balanceBreakdown?.completed_balance ?? 0),
    reservedRefundAmount: Number(balanceBreakdown?.reserved_refund_amount ?? 0),
    availableBalance: Number(balanceBreakdown?.available_balance ?? 0),
  };
}

function getRefundRequestResponseStatus({
  automaticRefundStatus,
  alreadyExists,
}: {
  automaticRefundStatus: string;
  alreadyExists: boolean;
}) {
  if (automaticRefundStatus === "completed") {
    return "completed";
  }

  if (automaticRefundStatus === "processing" || automaticRefundStatus === "manual_review") {
    return "processing";
  }

  if (automaticRefundStatus === "failed") {
    return "failed";
  }

  return alreadyExists ? "existing" : "pending";
}

async function isRecentFailedAttemptCoolingDown(refundRequestId: number) {
  const latestAttempt = await getLatestSumUpRefundAttemptForRequest(refundRequestId);

  if (latestAttempt?.status !== "failed") {
    return false;
  }

  const updatedAt = Date.parse(latestAttempt.updated_at || latestAttempt.created_at);

  return Number.isFinite(updatedAt) && Date.now() - updatedAt < failedAutomaticRefundRetryCooldownMs;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as RefundRequestPayload | null;
    const sourceWalletTransactionId = parseSourceWalletTransactionId(body?.source_wallet_transaction_id);

    if (!sourceWalletTransactionId) {
      return Response.json({ error: "Please choose a refundable wallet credit." }, { status: 400 });
    }

    const result = await createWalletRefundRequest({
      userId: user.id,
      sourceWalletTransactionId,
    });

    if (!result.success) {
      return Response.json(
        {
          error: getMessageForRefundRequestReason(result.reason),
          reason: result.reason,
        },
        { status: getStatusForRefundRequestReason(result.reason) }
      );
    }

    if (!result.alreadyExists) {
      await sendRefundOutcomeEmail({
        refundRequestId: result.refundRequestId,
        userId: user.id,
        outcome: "requested",
      });
    }

    let automaticRefund:
      | ReturnType<typeof automaticRefundDisabled>
      | ReturnType<typeof automaticRefundAlreadyCompleted>
      | ReturnType<typeof automaticRefundFromProcessorResult> = automaticRefundDisabled();

    let responseBalanceBreakdown = {
      completedBalance: result.completedBalance,
      reservedRefundAmount: result.reservedRefundAmount,
      availableBalance: result.availableBalance,
    };

    const refundRequestStatus = result.refundRequestId
      ? await getRefundRequestStatus(result.refundRequestId, user.id)
      : null;

    if (refundRequestStatus === "completed") {
      automaticRefund = automaticRefundAlreadyCompleted();
    } else {
      const automaticRefundDependencies = getAutomaticRefundProcessorDependencies();

      if (automaticRefundDependencies && result.refundRequestId) {
        if (await isRecentFailedAttemptCoolingDown(result.refundRequestId)) {
          automaticRefund = automaticRefundRetryCoolingDown();
        } else {
          const processorResult = await processAutomaticSumUpRefund({
            refundRequestId: result.refundRequestId,
            actorUserId: user.id,
            initiatedBy: "player",
            ...automaticRefundDependencies,
          });

          automaticRefund = automaticRefundFromProcessorResult(processorResult);

          if (processorResult.outcome === "completed") {
            responseBalanceBreakdown = {
              completedBalance: processorResult.balanceBreakdown.completedBalance,
              reservedRefundAmount: processorResult.balanceBreakdown.reservedRefundAmount,
              availableBalance: processorResult.balanceBreakdown.availableBalance,
            };
            await sendRefundOutcomeEmail({
              refundRequestId: result.refundRequestId,
              userId: user.id,
              outcome: "completed",
            });
          } else if (processorResult.outcome === "sumup_failed") {
            responseBalanceBreakdown = await releaseFailedRefundRequest(
              result.refundRequestId,
              user.id
            );
            await sendRefundOutcomeEmail({
              refundRequestId: result.refundRequestId,
              userId: user.id,
              outcome: "failed_credit_available",
            });
          } else if (processorResult.outcome === "sumup_unknown") {
            await sendRefundOutcomeEmail({
              refundRequestId: result.refundRequestId,
              userId: user.id,
              outcome: "manual_review",
            });
          }
        }
      }
    }

    return Response.json({
      refund_request: {
        id: result.refundRequestId,
        status: getRefundRequestResponseStatus({
          automaticRefundStatus: automaticRefund.status,
          alreadyExists: result.alreadyExists,
        }),
      },
      already_exists: result.alreadyExists,
      automatic_refund: automaticRefund,
      balance: responseBalanceBreakdown.availableBalance,
      balance_breakdown: responseBalanceBreakdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request refund.";
    return Response.json({ error: message }, { status: 500 });
  }
}
