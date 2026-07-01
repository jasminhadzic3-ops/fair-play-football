import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RefundRequestPayload = {
  amount?: unknown;
};

type PendingRefundRequest = {
  id: number;
};

function parseRefundAmount(value: unknown) {
  const amount = Number(value);

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isDuplicatePendingRefundError(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23505" ||
    Boolean(error?.message?.toLowerCase().includes("wallet_refund_requests_one_pending_per_user_currency"))
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currency = "GBP";
    const body = (await request.json().catch(() => null)) as RefundRequestPayload | null;
    const requestedAmount = parseRefundAmount(body?.amount);

    if (!requestedAmount) {
      return Response.json({ error: "Please enter a refund amount greater than zero." }, { status: 400 });
    }

    const { data: balanceData, error: balanceError } = await supabaseAdmin.rpc("get_wallet_balance", {
      p_user_id: user.id,
      p_currency: currency,
    });

    if (balanceError) {
      return Response.json({ error: balanceError.message }, { status: 500 });
    }

    const balance = Number(balanceData ?? 0);

    if (!Number.isFinite(balance) || balance <= 0) {
      return Response.json({ error: "There is no wallet balance available to refund." }, { status: 400 });
    }

    if (requestedAmount > balance) {
      return Response.json({ error: "Refund amount cannot be greater than your wallet balance." }, { status: 400 });
    }

    const { data: existingRequest, error: existingRequestError } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", currency)
      .eq("transaction_type", "refund_requested")
      .eq("status", "pending")
      .maybeSingle<PendingRefundRequest>();

    if (existingRequestError) {
      return Response.json({ error: existingRequestError.message }, { status: 500 });
    }

    if (existingRequest) {
      return Response.json(
        { error: "You already have a pending refund request.", refund_request_id: existingRequest.id },
        { status: 409 }
      );
    }

    const { data: refundRequest, error: insertError } = await supabaseAdmin
      .from("wallet_transactions")
      .insert({
        user_id: user.id,
        amount: -requestedAmount,
        currency,
        transaction_type: "refund_requested",
        status: "pending",
        description: "Refund requested",
        metadata: {
          source: "wallet_refund_request_api",
          requested_balance: balance,
        },
      })
      .select("id,amount,currency,transaction_type,status,description,created_at")
      .single();

    if (insertError) {
      if (isDuplicatePendingRefundError(insertError)) {
        return Response.json({ error: "You already have a pending refund request." }, { status: 409 });
      }

      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({
      refund_request: refundRequest,
      balance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request refund.";
    return Response.json({ error: message }, { status: 500 });
  }
}
