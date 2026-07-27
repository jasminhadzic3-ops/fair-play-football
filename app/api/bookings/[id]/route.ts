import { NextRequest } from "next/server";
import { cancelPlayerBookingWithRefundPolicy } from "@/lib/playerBookingCancellation";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

function parseBookingId(id: string) {
  const bookingId = Number(id);

  return Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null;
}

async function getAuthenticatedUser(authHeader: string | null) {
  assertSupabaseAdminConfigured();

  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const bookingId = parseBookingId(id);

    if (!bookingId) {
      return Response.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId,
      userId: user.id,
    });

    if (!result.success) {
      return Response.json(
        {
          error: result.message,
          reason: result.reason,
        },
        { status: result.status }
      );
    }

    if (result.released && result.shouldNotifyWaitingList && result.gameId) {
      await notifyWaitingListForOpenSpace(result.gameId).catch((notificationError) => {
        console.warn("Unable to notify waiting list after player cancelled booking:", notificationError);
      });
    }

    return Response.json({
      ok: true,
      message: result.message,
      booking_id: result.bookingId,
      game_id: result.gameId,
      released: result.released,
      refund_eligible: result.refundEligible,
      refund_policy: result.refundPolicy,
      payment_method: result.paymentMethod,
      amount: result.amount,
      currency: result.currency,
      source_credit_transaction_id: result.sourceCreditTransactionId,
      refund_request_id: result.refundRequestId,
      wallet_restoration_transaction_id: result.walletRestorationTransactionId,
      automatic_refund: result.automaticRefund,
      waiting_list_notified: result.released && result.shouldNotifyWaitingList,
    });
  } catch (error) {
    console.error("Unable to cancel booking:", error);
    return Response.json(
      { error: "Unable to cancel this booking. Please contact Fair Play Football." },
      { status: 500 }
    );
  }
}
