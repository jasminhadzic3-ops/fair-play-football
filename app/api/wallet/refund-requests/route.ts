import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { createWalletRefundRequest } from "@/lib/wallet";

type RefundRequestPayload = {
  source_wallet_transaction_id?: unknown;
};

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

    return Response.json({
      refund_request: {
        id: result.refundRequestId,
        status: result.alreadyExists ? "existing" : "pending",
      },
      already_exists: result.alreadyExists,
      balance: result.availableBalance,
      balance_breakdown: {
        completedBalance: result.completedBalance,
        reservedRefundAmount: result.reservedRefundAmount,
        availableBalance: result.availableBalance,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request refund.";
    return Response.json({ error: message }, { status: 500 });
  }
}
