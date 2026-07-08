import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
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

    if (action !== "approve" && action !== "reject") {
      return Response.json({ error: "Invalid refund request action." }, { status: 400 });
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
