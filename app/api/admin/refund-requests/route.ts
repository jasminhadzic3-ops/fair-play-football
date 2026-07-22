import { NextRequest } from "next/server";
import { buildAdminRefundCandidates } from "@/lib/adminRefundCandidates";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { getAutomaticRefundDependency } from "@/lib/sumupRefundDependencies";
import { processAutomaticSumUpRefund } from "@/lib/sumupRefundProcessing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createWalletRefundRequest, getLatestSumUpRefundAttemptForRequest } from "@/lib/wallet";

type AdminCreateRefundPayload = {
  source_wallet_transaction_id?: unknown;
};

type WalletTransactionRow = {
  id: number;
  user_id: string | null;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  amount: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type RefundRequestRow = WalletTransactionRow;

const failedAutomaticRefundRetryCooldownMs = 60 * 1000;

function parseSourceWalletTransactionId(value: unknown) {
  const sourceWalletTransactionId = Number(value);

  return Number.isInteger(sourceWalletTransactionId) && sourceWalletTransactionId > 0
    ? sourceWalletTransactionId
    : null;
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function getStatusForRefundRequestReason(reason: string | null) {
  switch (reason) {
    case "source_credit_not_found":
      return 404;
    case "invalid_user":
    case "invalid_source_credit":
    case "source_credit_not_owned":
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
      return "Refundable cancellation credit not found.";
    case "source_credit_not_owned":
      return "Refundable cancellation credit does not belong to the linked player.";
    case "not_sumup_cancellation_credit":
      return "Only SumUp cancellation credits can be refunded to card.";
    case "invalid_source_amount":
      return "Refundable cancellation credit has an invalid amount.";
    case "insufficient_balance":
      return "The player does not have enough available wallet balance for this refund.";
    case "idempotency_key_conflict":
      return "This refund request conflicts with an existing wallet transaction.";
    default:
      return "Unable to create refund request.";
  }
}

function automaticRefundDisabled() {
  return {
    status: "disabled",
    message: "Refund request created; SumUp processing is not enabled.",
  };
}

function automaticRefundExisting(message: string, status = "requested") {
  return {
    status,
    message,
  };
}

function automaticRefundRetryCoolingDown() {
  return {
    status: "failed",
    message: "A recent SumUp refund attempt failed. Use the Refund Requests queue before retrying.",
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
        completed_balance: result.balanceBreakdown.completedBalance,
        reserved_refund_amount: result.balanceBreakdown.reservedRefundAmount,
        available_balance: result.balanceBreakdown.availableBalance,
      },
    };
  }

  if (result.outcome === "sumup_unknown") {
    return {
      status: "manual_review",
      message: "Refund needs review. Use Recheck SumUp before retrying.",
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
      message: "Automatic SumUp refund could not complete. The request remains safe for review.",
      diagnostic_code: result.diagnosticCode,
      sumup_refund_attempt: {
        id: result.attemptId,
        status: "failed",
      },
    };
  }

  if (result.outcome === "blocked") {
    return {
      status: result.attemptStatus === "unknown" ? "manual_review" : "processing",
      message:
        result.attemptStatus === "unknown"
          ? "Refund needs review. Use Recheck SumUp before retrying."
          : "Refund processing. No second SumUp refund was sent.",
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
    message: result.error || "Automatic refund is unavailable. The refund request remains reserved.",
    reason: result.outcome === "claim_failed" ? result.reason : undefined,
  };
}

function getRefundRequestResponseStatus(automaticRefundStatus: string, alreadyExists: boolean) {
  if (automaticRefundStatus === "completed") {
    return "completed";
  }

  if (automaticRefundStatus === "processing" || automaticRefundStatus === "manual_review") {
    return "processing";
  }

  return alreadyExists ? "existing" : "pending";
}

function getCandidateStatusForAutomaticRefundStatus(automaticRefundStatus: string) {
  switch (automaticRefundStatus) {
    case "completed":
      return "completed";
    case "manual_review":
      return "needs_review";
    case "failed":
      return "failed";
    case "processing":
      return "processing";
    default:
      return "requested";
  }
}

async function isRecentFailedAttemptCoolingDown(refundRequestId: number) {
  const latestAttempt = await getLatestSumUpRefundAttemptForRequest(refundRequestId);

  if (latestAttempt?.status !== "failed") {
    return false;
  }

  const updatedAt = Date.parse(latestAttempt.updated_at || latestAttempt.created_at);

  return Number.isFinite(updatedAt) && Date.now() - updatedAt < failedAutomaticRefundRetryCooldownMs;
}

async function loadRefundCandidate(sourceWalletTransactionId: number) {
  const { data: sourceCredit, error: sourceCreditError } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,user_id,game_id,booking_id,payment_id,amount,currency,transaction_type,status,metadata,created_at")
    .eq("id", sourceWalletTransactionId)
    .maybeSingle<WalletTransactionRow>();

  if (sourceCreditError) {
    throw sourceCreditError;
  }

  if (!sourceCredit) {
    return null;
  }

  const gameId = sourceCredit.game_id ?? getMetadataNumber(sourceCredit.metadata, "original_game_id");
  const bookingId = sourceCredit.booking_id ?? getMetadataNumber(sourceCredit.metadata, "original_booking_id");
  const paymentId = sourceCredit.payment_id ?? getMetadataNumber(sourceCredit.metadata, "original_payment_id");

  const [
    gameResult,
    bookingResult,
    profileResult,
    bookingPaymentsResult,
    bookingWalletTransactionsResult,
    refundRequestsResult,
  ] = await Promise.all([
    gameId
      ? supabaseAdmin.from("games").select("id,status").eq("id", gameId)
      : Promise.resolve({ data: [], error: null }),
    bookingId
      ? supabaseAdmin.from("bookings").select("id,game_id,user_id,player_name").eq("id", bookingId)
      : Promise.resolve({ data: [], error: null }),
    sourceCredit.user_id
      ? supabaseAdmin.from("profiles").select("id,username").eq("id", sourceCredit.user_id)
      : Promise.resolve({ data: [], error: null }),
    bookingId
      ? supabaseAdmin
          .from("booking_payments")
          .select("id,user_id,game_id,booking_id,payment_status,amount,currency,transaction_code,sumup_transaction_id")
          .eq("booking_id", bookingId)
      : paymentId
        ? supabaseAdmin
            .from("booking_payments")
            .select("id,user_id,game_id,booking_id,payment_status,amount,currency,transaction_code,sumup_transaction_id")
            .eq("id", paymentId)
        : Promise.resolve({ data: [], error: null }),
    bookingId
      ? supabaseAdmin
          .from("wallet_transactions")
          .select("id,user_id,game_id,booking_id,payment_id,amount,currency,transaction_type,status,metadata,created_at")
          .eq("booking_id", bookingId)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("wallet_transactions")
      .select("id,user_id,game_id,booking_id,payment_id,amount,currency,transaction_type,status,metadata,created_at")
      .eq("transaction_type", "refund_requested")
      .eq("metadata->>source_wallet_transaction_id", sourceWalletTransactionId.toString()),
  ]);

  const firstError =
    gameResult.error ||
    bookingResult.error ||
    profileResult.error ||
    bookingPaymentsResult.error ||
    bookingWalletTransactionsResult.error ||
    refundRequestsResult.error;

  if (firstError) {
    throw firstError;
  }

  const refundRequests = (refundRequestsResult.data ?? []) as RefundRequestRow[];
  const refundRequestIds = refundRequests.map((request) => request.id);
  const sumUpRefundAttemptsResult =
    refundRequestIds.length > 0
      ? await supabaseAdmin
          .from("sumup_refund_attempts")
          .select("id,refund_request_id,status,created_at,updated_at")
          .in("refund_request_id", refundRequestIds)
      : { data: [], error: null };

  if (sumUpRefundAttemptsResult.error) {
    throw sumUpRefundAttemptsResult.error;
  }

  const candidates = buildAdminRefundCandidates({
    games: gameResult.data ?? [],
    bookings: bookingResult.data ?? [],
    profiles: profileResult.data ?? [],
    bookingPayments: bookingPaymentsResult.data ?? [],
    walletTransactions: [
      sourceCredit,
      ...((bookingWalletTransactionsResult.data ?? []) as WalletTransactionRow[]).filter(
        (transaction) => transaction.id !== sourceCredit.id
      ),
      ...refundRequests,
    ],
    sumUpRefundAttempts: sumUpRefundAttemptsResult.data ?? [],
  });

  return candidates.find((candidate) => candidate.source_wallet_transaction_id === sourceWalletTransactionId) ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as AdminCreateRefundPayload | null;
    const sourceWalletTransactionId = parseSourceWalletTransactionId(body?.source_wallet_transaction_id);

    if (!sourceWalletTransactionId) {
      return Response.json({ error: "Choose a cancellation credit to refund." }, { status: 400 });
    }

    const candidate = await loadRefundCandidate(sourceWalletTransactionId);

    if (!candidate) {
      return Response.json({ error: "Refundable cancellation credit not found." }, { status: 404 });
    }

    if (candidate.refund_request_id) {
      return Response.json({
        refund_candidate: candidate,
        refund_request: {
          id: candidate.refund_request_id,
          status: candidate.refund_status === "completed" ? "completed" : "existing",
        },
        already_exists: true,
        automatic_refund: automaticRefundExisting(candidate.safe_reason, candidate.refund_status),
      });
    }

    if (!candidate.refund_eligible) {
      return Response.json(
        {
          error: candidate.safe_reason,
          refund_candidate: candidate,
        },
        { status: candidate.refund_request_id ? 409 : 400 }
      );
    }

    if (!candidate.user_id) {
      return Response.json({ error: "Linked player details are incomplete." }, { status: 400 });
    }

    const refundRequestResult = await createWalletRefundRequest({
      userId: candidate.user_id,
      sourceWalletTransactionId,
    });

    if (!refundRequestResult.success) {
      return Response.json(
        {
          error: getMessageForRefundRequestReason(refundRequestResult.reason),
          reason: refundRequestResult.reason,
        },
        { status: getStatusForRefundRequestReason(refundRequestResult.reason) }
      );
    }

    let automaticRefund = automaticRefundDisabled();

    if (refundRequestResult.alreadyExists) {
      automaticRefund = automaticRefundExisting(
        "Refund request already exists. Use the Refund Requests queue for processing and recovery."
      );
    } else if (refundRequestResult.refundRequestId) {
      const refundDependency = getAutomaticRefundDependency();

      if (refundDependency) {
        if (await isRecentFailedAttemptCoolingDown(refundRequestResult.refundRequestId)) {
          automaticRefund = automaticRefundRetryCoolingDown();
        } else {
          automaticRefund = automaticRefundFromProcessorResult(
            await processAutomaticSumUpRefund({
              refundRequestId: refundRequestResult.refundRequestId,
              actorUserId: adminUser.id,
              initiatedBy: "admin",
              refundDependency,
            })
          );
        }
      }
    }

    return Response.json({
      refund_candidate: {
        ...candidate,
        refund_eligible: false,
        refund_status: getCandidateStatusForAutomaticRefundStatus(automaticRefund.status),
        refund_request_id: refundRequestResult.refundRequestId,
        safe_reason: automaticRefund.message,
      },
      refund_request: {
        id: refundRequestResult.refundRequestId,
        status: getRefundRequestResponseStatus(automaticRefund.status, refundRequestResult.alreadyExists),
      },
      already_exists: refundRequestResult.alreadyExists,
      automatic_refund: automaticRefund,
      balance_breakdown: {
        completed_balance: refundRequestResult.completedBalance,
        reserved_refund_amount: refundRequestResult.reservedRefundAmount,
        available_balance: refundRequestResult.availableBalance,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create admin refund request.";
    return Response.json({ error: message }, { status: 500 });
  }
}
