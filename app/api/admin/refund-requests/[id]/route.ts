import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import {
  processAutomaticSumUpRefund,
  type SumUpRefundDependency,
} from "@/lib/sumupRefundProcessing";
import { getAutomaticSumUpRefundMode } from "@/lib/sumupRefundCapabilities";
import { refundSumUpTransaction, SumUpRefundHttpError } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { completeWalletRefundRequest } from "@/lib/wallet";

type RefundRequestPayload = {
  action?: unknown;
  reason?: unknown;
};

type RefundRequestRow = {
  id: number;
  user_id: string;
  amount: number | string;
  currency: string | null;
  metadata: Record<string, unknown> | null;
};

type UpdatedRefundRequestRow = {
  id: number;
  status: string;
  admin_note: string | null;
  metadata: Record<string, unknown> | null;
};

function parseRefundRequestId(id: string) {
  const refundRequestId = Number(id);

  return Number.isInteger(refundRequestId) && refundRequestId > 0 ? refundRequestId : null;
}

function normalizeOptionalReason(reason: unknown) {
  return typeof reason === "string" ? reason.trim() || null : null;
}

function mergeRefundRequestMetadata(
  metadata: Record<string, unknown> | null,
  nextMetadata: Record<string, unknown>
) {
  return {
    ...(metadata ?? {}),
    ...nextMetadata,
  };
}

function getStatusForCompletionReason(reason: string | null) {
  switch (reason) {
    case "refund_request_not_found":
      return 404;
    case "insufficient_balance":
    case "invalid_refund_request_status":
    case "idempotency_key_conflict":
      return 409;
    case "invalid_refund_request":
    case "invalid_admin_user":
    case "invalid_refund_amount":
      return 400;
    default:
      return 500;
  }
}

function getMessageForCompletionReason(reason: string | null) {
  switch (reason) {
    case "insufficient_balance":
      return "Insufficient wallet balance for this refund.";
    case "invalid_refund_request_status":
      return "Refund request is not pending.";
    case "refund_request_not_found":
      return "Pending refund request not found.";
    case "idempotency_key_conflict":
      return "This refund completion conflicts with an existing transaction.";
    case "invalid_refund_amount":
      return "Invalid refund request amount.";
    default:
      return "Unable to complete refund.";
  }
}

async function loadPendingRefundRequest(refundRequestId: number) {
  const { data: refundRequest, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,user_id,amount,currency,metadata")
    .eq("id", refundRequestId)
    .eq("transaction_type", "refund_requested")
    .eq("status", "pending")
    .maybeSingle<RefundRequestRow>();

  if (error) {
    throw error;
  }

  return refundRequest;
}

function getTestOnlyMockRefundDependency(): SumUpRefundDependency {
  return async ({ transactionId, amount }) => {
    const outcome = process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME || "succeeded";

    if (outcome === "failed") {
      return {
        outcome: "failed",
        errorMessage: "Mocked SumUp refund failure.",
        response: {
          error_message: "Mocked SumUp refund failure.",
          transaction_id: transactionId,
          amount,
        },
      };
    }

    if (outcome === "unknown") {
      return {
        outcome: "unknown",
        errorMessage: "Mocked ambiguous SumUp refund outcome.",
        response: {
          transaction_id: transactionId,
          amount,
          status: "UNKNOWN",
        },
      };
    }

    return {
      outcome: "succeeded",
      response: {
        id: `mock-refund-${transactionId}`,
        status: "SUCCESSFUL",
        transaction_id: transactionId,
        amount,
      },
    };
  };
}

function isAmbiguousSumUpRefundHttpStatus(status: number) {
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 429;
}

function safeRefundHttpErrorResponse(error: SumUpRefundHttpError) {
  if (error.responseBody && typeof error.responseBody === "object") {
    return error.responseBody as Record<string, unknown>;
  }

  return {
    message: error.message,
    status: error.status,
  };
}

function getRealSumUpRefundDependency(): SumUpRefundDependency {
  return async ({ transactionId, amount }) => {
    try {
      const result = await refundSumUpTransaction({ transactionId, amount });

      return {
        outcome: "succeeded",
        response: result.response,
      };
    } catch (error) {
      if (error instanceof SumUpRefundHttpError) {
        const response = safeRefundHttpErrorResponse(error);

        if (isAmbiguousSumUpRefundHttpStatus(error.status)) {
          return {
            outcome: "unknown",
            errorMessage: error.message,
            response,
          };
        }

        return {
          outcome: "failed",
          errorMessage: error.message,
          response,
        };
      }

      return {
        outcome: "unknown",
        errorMessage: error instanceof Error ? error.message : "Unknown SumUp refund outcome.",
        response: null,
      };
    }
  };
}

function getAutomaticRefundDependency(): SumUpRefundDependency | null {
  const mode = getAutomaticSumUpRefundMode();

  if (mode === "test_mock") {
    return getTestOnlyMockRefundDependency();
  }

  if (mode === "production_real") {
    return getRealSumUpRefundDependency();
  }

  return null;
}

function getAttemptStatusForProcessorResult(result: Awaited<ReturnType<typeof processAutomaticSumUpRefund>>) {
  if (result.outcome === "sumup_unknown") {
    return "unknown";
  }

  if (result.outcome === "sumup_failed") {
    return "failed";
  }

  if ("attemptStatus" in result) {
    return result.attemptStatus;
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const refundRequestId = parseRefundRequestId(id);

    if (!refundRequestId) {
      return Response.json({ error: "Invalid refund request id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as RefundRequestPayload | null;
    const action = body?.action;

    if (action !== "approve" && action !== "reject" && action !== "refund_via_sumup") {
      return Response.json({ error: "Invalid refund request action." }, { status: 400 });
    }

    if (action === "refund_via_sumup") {
      const refundDependency = getAutomaticRefundDependency();

      if (!refundDependency) {
        return Response.json(
          { error: "Automatic SumUp refunds are not enabled in this environment." },
          { status: 403 }
        );
      }

      const result = await processAutomaticSumUpRefund({
        refundRequestId,
        adminUserId: adminUser.id,
        refundDependency,
      });

      if (result.outcome === "completed") {
        return Response.json({
          message: result.message,
          refund_request: {
            id: result.refundRequestId,
            status: "completed",
          },
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
        });
      }

      return Response.json(
        {
          error: result.error,
          outcome: result.outcome,
          sumup_refund_attempt:
            "attemptId" in result
              ? {
                  id: result.attemptId,
                  status: getAttemptStatusForProcessorResult(result),
                }
              : null,
        },
        { status: result.status }
      );
    }

    const refundRequest = await loadPendingRefundRequest(refundRequestId);

    if (!refundRequest) {
      return Response.json({ error: "Pending refund request not found." }, { status: 404 });
    }

    const reason = normalizeOptionalReason(body?.reason);
    const processedAt = new Date().toISOString();

    if (action === "reject") {
      const { data: updatedRequest, error: updateError } = await supabaseAdmin
        .from("wallet_transactions")
        .update({
          status: "cancelled",
          admin_note: reason,
          metadata: mergeRefundRequestMetadata(refundRequest.metadata, {
            rejected_by: adminUser.id,
            rejected_at: processedAt,
            rejection_reason: reason,
          }),
        })
        .eq("id", refundRequest.id)
        .eq("status", "pending")
        .select("id,status,admin_note,metadata")
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      if (!updatedRequest) {
        return Response.json({ error: "Pending refund request not found." }, { status: 404 });
      }

      return Response.json({ refund_request: updatedRequest });
    }

    let completionResult;

    try {
      completionResult = await completeWalletRefundRequest({
        refundRequestId: refundRequest.id,
        adminUserId: adminUser.id,
        idempotencyKey: `refund_completed:request:${refundRequest.id}`,
        description: "Refund completed",
        adminNote: reason,
        metadata: {
          refund_request_id: refundRequest.id,
          processed_by: adminUser.id,
          manual: true,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete refund.";

      return Response.json({ error: message }, { status: 500 });
    }

    if (!completionResult.success) {
      return Response.json(
        { error: getMessageForCompletionReason(completionResult.reason), reason: completionResult.reason },
        { status: getStatusForCompletionReason(completionResult.reason) }
      );
    }

    const { data: updatedRequest, error: updatedRequestError } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,status,admin_note,metadata")
      .eq("id", refundRequest.id)
      .maybeSingle<UpdatedRefundRequestRow>();

    if (updatedRequestError) {
      throw updatedRequestError;
    }

    if (!updatedRequest) {
      return Response.json({ error: "Refund completed but request status could not be loaded." }, { status: 409 });
    }

    return Response.json({
      refund_request: updatedRequest,
      refund_transaction: completionResult.refundTransactionId
        ? { id: completionResult.refundTransactionId }
        : null,
      balance_breakdown: {
        completed_balance: completionResult.completedBalance,
        reserved_refund_amount: completionResult.reservedRefundAmount,
        available_balance: completionResult.availableBalance,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process refund request.";
    return Response.json({ error: message }, { status: 500 });
  }
}
