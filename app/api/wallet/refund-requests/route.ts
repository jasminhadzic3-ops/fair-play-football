import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getWalletBalanceBreakdown } from "@/lib/wallet";

type RefundRequestPayload = {
  source_wallet_transaction_id?: unknown;
};

type PendingRefundRequest = {
  id: number;
};

type SourceCreditRow = {
  id: number;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  metadata: Record<string, unknown> | null;
};

function parseSourceWalletTransactionId(value: unknown) {
  const sourceWalletTransactionId = Number(value);

  return Number.isInteger(sourceWalletTransactionId) && sourceWalletTransactionId > 0
    ? sourceWalletTransactionId
    : null;
}

function isDuplicatePendingRefundError(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23505" ||
    Boolean(
      error?.message
        ?.toLowerCase()
        .includes("wallet_refund_requests_one_active_per_source_credit")
    )
  );
}

function isEligibleSumUpCancellationCredit(sourceCredit: SourceCreditRow, userId: string) {
  return (
    sourceCredit.user_id === userId &&
    sourceCredit.transaction_type === "game_cancelled_credit" &&
    sourceCredit.status === "completed" &&
    Number(sourceCredit.amount) > 0 &&
    Boolean(sourceCredit.payment_id) &&
    sourceCredit.metadata?.original_payment_method === "sumup"
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
    const sourceWalletTransactionId = parseSourceWalletTransactionId(body?.source_wallet_transaction_id);

    if (!sourceWalletTransactionId) {
      return Response.json({ error: "Please choose a refundable wallet credit." }, { status: 400 });
    }

    const { data: sourceCredit, error: sourceCreditError } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,user_id,amount,currency,transaction_type,status,game_id,booking_id,payment_id,metadata")
      .eq("id", sourceWalletTransactionId)
      .maybeSingle<SourceCreditRow>();

    if (sourceCreditError) {
      return Response.json({ error: sourceCreditError.message }, { status: 500 });
    }

    if (!sourceCredit || sourceCredit.user_id !== user.id) {
      return Response.json({ error: "Refundable wallet credit not found." }, { status: 404 });
    }

    if (!isEligibleSumUpCancellationCredit(sourceCredit, user.id)) {
      return Response.json(
        { error: "Only SumUp cancellation credits can be requested for card refund." },
        { status: 400 }
      );
    }

    const requestedAmount = Number(sourceCredit.amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return Response.json({ error: "Refundable wallet credit has an invalid amount." }, { status: 409 });
    }

    const balanceBreakdown = await getWalletBalanceBreakdown({
      userId: user.id,
      currency: sourceCredit.currency ?? currency,
    });
    const balance = balanceBreakdown.availableBalance;

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
      .eq("transaction_type", "refund_requested")
      .in("status", ["pending", "processing", "completed"])
      .eq("metadata->>source_wallet_transaction_id", String(sourceCredit.id))
      .maybeSingle<PendingRefundRequest>();

    if (existingRequestError) {
      return Response.json({ error: existingRequestError.message }, { status: 500 });
    }

    if (existingRequest) {
      return Response.json(
        {
          error: "A refund has already been requested for this wallet credit.",
          refund_request_id: existingRequest.id,
        },
        { status: 409 }
      );
    }

    const { data: refundRequest, error: insertError } = await supabaseAdmin
      .from("wallet_transactions")
      .insert({
        user_id: user.id,
        amount: -requestedAmount,
        currency: sourceCredit.currency ?? currency,
        transaction_type: "refund_requested",
        status: "pending",
        description: "Refund requested",
        metadata: {
          source_wallet_transaction_id: sourceCredit.id,
          source_transaction_type: sourceCredit.transaction_type,
          original_payment_method: sourceCredit.metadata?.original_payment_method,
          original_payment_id: sourceCredit.payment_id,
          original_game_id: sourceCredit.game_id,
          original_booking_id: sourceCredit.booking_id,
          refund_mode: "source_credit",
          automatic_refund_eligible: true,
        },
      })
      .select("id,amount,currency,transaction_type,status,description,created_at")
      .single();

    if (insertError) {
      if (isDuplicatePendingRefundError(insertError)) {
        return Response.json(
          { error: "A refund has already been requested for this wallet credit." },
          { status: 409 }
        );
      }

      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({
      refund_request: refundRequest,
      balance,
      balance_breakdown: balanceBreakdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request refund.";
    return Response.json({ error: message }, { status: 500 });
  }
}
