import { NextRequest } from "next/server";
import { finalizeCheckoutPayment, getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function serializeCheckoutStatusError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkoutId = request.nextUrl.searchParams.get("checkout_id");
  const checkoutReference = request.nextUrl.searchParams.get("checkout_reference");

  console.log("[SUMUP_DEBUG] entering checkout-status", {
    hasCheckoutId: Boolean(checkoutId),
    hasCheckoutReference: Boolean(checkoutReference),
  });

  if (!checkoutId && !checkoutReference) {
    return Response.json({ error: "Missing checkout_id or checkout_reference." }, { status: 400 });
  }

  let paymentQuery = supabaseAdmin
    .from("booking_payments")
    .select("user_id,game_id,checkout_id,payment_status,booking_id");

  paymentQuery = checkoutId
    ? paymentQuery.eq("checkout_id", checkoutId)
    : paymentQuery.eq("checkout_reference", checkoutReference);

  const { data: payment, error } = await paymentQuery.maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!payment || payment.user_id !== user.id) {
    return Response.json({ error: "Payment not found." }, { status: 404 });
  }

  try {
    const result = await finalizeCheckoutPayment(payment.checkout_id);
    console.log("[SUMUP_DEBUG] checkout-status returning finalizeCheckoutPayment result", {
      checkoutId: payment.checkout_id,
      gameId: payment.game_id,
      returnedPaymentStatus: result.paymentStatus,
      returnedBookingId: result.bookingId ?? null,
    });
    return Response.json({
      ...result,
      checkoutId: payment.checkout_id,
      gameId: payment.game_id,
    });
  } catch (statusError) {
    console.error("[SUMUP_DEBUG] finalizeCheckoutPayment failed; returning local payment status", {
      checkoutId: payment.checkout_id,
      gameId: payment.game_id,
      localPaymentStatus: payment.payment_status,
      localBookingId: payment.booking_id ?? null,
      error: serializeCheckoutStatusError(statusError),
    });
    return Response.json({
      checkoutId: payment.checkout_id,
      gameId: payment.game_id,
      paymentStatus: payment.payment_status,
      bookingId: payment.booking_id ?? null,
    });
  }
}
