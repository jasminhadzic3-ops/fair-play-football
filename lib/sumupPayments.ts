import { sendBookingConfirmedEmail } from "./email/bookingConfirmed";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "./supabaseAdmin";

type SumUpCheckout = {
  id: string;
  status: "PENDING" | "FAILED" | "PAID" | "EXPIRED" | string;
  hosted_checkout_url?: string;
  transactions?: Array<{
    transaction_code?: string;
    status?: string;
  }>;
};

const sumupApiBase = "https://api.sumup.com/v0.1";
const noSpacePaymentMessage = "This spot has already been taken. You are still on the waiting list.";

type CreateBookingIfSpaceResult = {
  success: boolean;
  booking_id: number | null;
  reason: string | null;
};

async function readJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

function getSumUpApiKey() {
  const apiKey = process.env.SUMUP_API_KEY;

  if (!apiKey) {
    throw new Error("SUMUP_API_KEY is required.");
  }

  return apiKey;
}

async function removeWaitingListEntryForBookedUser(userId: string, gameId: number) {
  const { error } = await supabaseAdmin
    .from("waiting_list")
    .update({ status: "removed" })
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("status", "waiting");

  if (error) {
    throw error;
  }
}

export async function getAuthenticatedUser(authHeader: string | null) {
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

export async function createSumUpCheckout(params: {
  amount: number;
  checkoutReference: string;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
}) {
  const merchantCode = process.env.SUMUP_MERCHANT_CODE;

  if (!merchantCode) {
    throw new Error("SUMUP_MERCHANT_CODE is required.");
  }

  const response = await fetch(`${sumupApiBase}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSumUpApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      checkout_reference: params.checkoutReference,
      currency: process.env.SUMUP_CURRENCY || "GBP",
      description: params.description,
      merchant_code: merchantCode,
      return_url: params.webhookUrl,
      redirect_url: params.redirectUrl,
      hosted_checkout: { enabled: true },
    }),
  });

  const checkout = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(checkout?.message || checkout?.error_message || "Unable to create SumUp checkout.");
  }

  if (!checkout) {
    throw new Error("SumUp returned an empty checkout response.");
  }

  return checkout as SumUpCheckout;
}

export async function retrieveSumUpCheckout(checkoutId: string) {
  const response = await fetch(`${sumupApiBase}/checkouts/${checkoutId}`, {
    headers: {
      Authorization: `Bearer ${getSumUpApiKey()}`,
    },
  });

  const checkout = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(checkout?.message || checkout?.error_message || "Unable to retrieve SumUp checkout.");
  }

  if (!checkout) {
    throw new Error("SumUp returned an empty checkout status response.");
  }

  return checkout as SumUpCheckout;
}

export async function finalizeCheckoutPayment(checkoutId: string) {
  assertSupabaseAdminConfigured();

  const checkout = await retrieveSumUpCheckout(checkoutId);
  const status = checkout.status.toLowerCase();
  const transactionCode = checkout.transactions?.find((transaction) => transaction.transaction_code)
    ?.transaction_code;

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("booking_payments")
    .select("*")
    .eq("checkout_id", checkoutId)
    .maybeSingle();

  if (paymentError) {
    throw paymentError;
  }

  if (!payment) {
    throw new Error("Payment record not found.");
  }

  if (payment.payment_status === "paid_no_space") {
    return {
      paymentStatus: "paid_no_space",
      bookingId: null,
      reason: "game_full",
      message: noSpacePaymentMessage,
    };
  }

  if (status !== "paid") {
    const { error: updateError } = await supabaseAdmin
      .from("booking_payments")
      .update({
        payment_status: status,
        raw_checkout: checkout,
        transaction_code: transactionCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    if (updateError) {
      throw updateError;
    }

    return { paymentStatus: status, bookingId: payment.booking_id ?? null };
  }

  if (payment.booking_id) {
    const { error: updateError } = await supabaseAdmin
      .from("booking_payments")
      .update({
        payment_status: "paid",
        raw_checkout: checkout,
        transaction_code: transactionCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    if (updateError) {
      throw updateError;
    }

    await removeWaitingListEntryForBookedUser(payment.user_id, payment.game_id);

    return { paymentStatus: "paid", bookingId: payment.booking_id };
  }

  const { data: bookingResult, error: bookingRpcError } = await supabaseAdmin
    .rpc("create_booking_if_space", {
      p_game_id: payment.game_id,
      p_user_id: payment.user_id,
      p_player_name: payment.player_name,
    })
    .single<CreateBookingIfSpaceResult>();

  if (bookingRpcError) {
    throw bookingRpcError;
  }

  if (!bookingResult?.success) {
    if (bookingResult?.reason === "game_full") {
      const { data: updatedPayment, error: noSpaceUpdateError } = await supabaseAdmin
        .from("booking_payments")
        .update({
          booking_id: null,
          payment_status: "paid_no_space",
          raw_checkout: checkout,
          transaction_code: transactionCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .select("booking_id,payment_status")
        .single();

      if (noSpaceUpdateError) {
        throw noSpaceUpdateError;
      }

      if (updatedPayment?.payment_status !== "paid_no_space" || updatedPayment?.booking_id) {
        throw new Error("Unable to record paid checkout without available game space.");
      }

      return {
        paymentStatus: "paid_no_space",
        bookingId: null,
        reason: "game_full",
        message: noSpacePaymentMessage,
      };
    }

    throw new Error(`Unable to create booking after paid checkout: ${bookingResult?.reason || "unknown_reason"}.`);
  }

  const bookingId = bookingResult.booking_id;

  if (!bookingId) {
    throw new Error("Unable to create or find booking after paid checkout.");
  }

  const { data: updatedPayment, error: paymentUpdateError } = await supabaseAdmin
    .from("booking_payments")
    .update({
      booking_id: bookingId,
      payment_status: "paid",
      raw_checkout: checkout,
      transaction_code: transactionCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .is("booking_id", null)
    .select("booking_id,payment_status")
    .maybeSingle();

  if (paymentUpdateError) {
    throw paymentUpdateError;
  }

  if (!updatedPayment) {
    const { data: finalizedPayment, error: finalizedPaymentError } = await supabaseAdmin
      .from("booking_payments")
      .select("booking_id,payment_status")
      .eq("id", payment.id)
      .single();

    if (finalizedPaymentError) {
      throw finalizedPaymentError;
    }

    if (finalizedPayment?.payment_status === "paid" && finalizedPayment.booking_id) {
      return { paymentStatus: "paid", bookingId: finalizedPayment.booking_id };
    }

    throw new Error("Unable to claim paid payment record for finalized booking.");
  }

  if (updatedPayment?.booking_id !== bookingId) {
    throw new Error("Unable to write booking_id to paid payment record.");
  }

  await removeWaitingListEntryForBookedUser(payment.user_id, payment.game_id);

  try {
    await sendBookingConfirmedEmail({
      bookingId,
      paymentId: payment.id,
      userId: payment.user_id,
      gameId: payment.game_id,
      playerName: payment.player_name,
      amount: payment.amount,
      currency: payment.currency,
      checkoutId: payment.checkout_id,
      checkoutReference: payment.checkout_reference,
    });
  } catch (emailError) {
    console.error("Unable to send booking confirmation email:", {
      bookingId,
      paymentId: payment.id,
      error: emailError,
    });
  }

  return { paymentStatus: "paid", bookingId };
}
