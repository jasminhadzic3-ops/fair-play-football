import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { debitWallet } from "@/lib/wallet";

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

    const amount = Math.abs(Number(refundRequest.amount));

    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Invalid refund request amount." }, { status: 409 });
    }

    let refundTransaction;

    try {
      refundTransaction = await debitWallet({
        userId: refundRequest.user_id,
        amount,
        currency: refundRequest.currency ?? "GBP",
        transactionType: "refund_completed",
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
      const status = message.toLowerCase().includes("insufficient wallet balance") ? 409 : 500;

      return Response.json({ error: message }, { status });
    }

    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from("wallet_transactions")
      .update({
        status: "completed",
        admin_note: reason,
        metadata: mergeRefundRequestMetadata(refundRequest.metadata, {
          refund_completed_transaction_id: refundTransaction.id,
          processed_by: adminUser.id,
          processed_at: processedAt,
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
      return Response.json({ error: "Refund was debited but request status could not be updated." }, { status: 409 });
    }

    return Response.json({
      refund_request: updatedRequest,
      refund_transaction: refundTransaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process refund request.";
    return Response.json({ error: message }, { status: 500 });
  }
}
