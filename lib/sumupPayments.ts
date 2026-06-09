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

    return { paymentStatus: "paid", bookingId: payment.booking_id };
  }

  const { data: existingBooking, error: existingBookingError } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .eq("user_id", payment.user_id)
    .eq("game_id", payment.game_id)
    .eq("player_name", payment.player_name)
    .maybeSingle();

  if (existingBookingError) {
    throw existingBookingError;
  }

  let bookingId = existingBooking?.id;

  if (!bookingId) {
    const { data: newBooking, error: bookingInsertError } = await supabaseAdmin
        .from("bookings")
        .insert({
          game_id: payment.game_id,
          player_name: payment.player_name,
          user_id: payment.user_id,
        })
        .select("id")
      .single();

    if (bookingInsertError) {
      throw bookingInsertError;
    }

    bookingId = newBooking?.id;
  }

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
    .select("booking_id")
    .single();

  if (paymentUpdateError) {
    throw paymentUpdateError;
  }

  if (updatedPayment?.booking_id !== bookingId) {
    throw new Error("Unable to write booking_id to paid payment record.");
  }

  return { paymentStatus: "paid", bookingId };
}
