import {
  removeWaitingListEntryForBookedUser,
  runPostBookingActions,
} from "@/lib/postBookingActions";
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

export type SumUpTransaction = {
  id: string;
  transaction_code: string;
  amount: number;
  currency: string;
  status: string;
  simple_status?: string;
  merchant_code?: string;
};

export type SumUpRefundResponse = {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  transaction_id?: string;
  [key: string]: unknown;
};

export type SumUpRefundResult = {
  transactionId: string;
  amount: number;
  response: SumUpRefundResponse | null;
};

export class SumUpRefundHttpError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(message: string, status: number, responseBody: unknown) {
    super(message);
    this.name = "SumUpRefundHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

const sumupApiBase = "https://api.sumup.com/v0.1";
const sumupApiRoot = "https://api.sumup.com";
const noSpacePaymentMessage = "This spot has already been taken. You are still on the waiting list.";

type CreateBookingIfSpaceResult = {
  success: boolean;
  booking_id: number | null;
  reason: string | null;
};

type BookingPaymentForSumUpResolution = {
  id: number;
  amount: number | string;
  currency: string | null;
  payment_status: string | null;
  transaction_code?: string | null;
  sumup_transaction_id?: string | null;
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

function boundedString(value: unknown, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue.slice(0, maxLength) : null;
}

function safeErrorResponseBody(response: Response, bodyText: string, parsedBody: unknown) {
  if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
    const body = parsedBody as Record<string, unknown>;

    return {
      message: boundedString(body.message),
      error_message: boundedString(body.error_message),
      detail: boundedString(body.detail),
      title: boundedString(body.title),
      error_code: boundedString(body.error_code, 100),
      status: boundedString(body.status, 100),
      amount: Number.isFinite(Number(body.amount)) ? Number(body.amount) : null,
      currency: boundedString(body.currency, 20),
      transaction_id: boundedString(body.transaction_id),
      http_status: response.status,
    };
  }

  return {
    message: bodyText.trim()
      ? "SumUp returned a non-JSON error response."
      : "SumUp returned an empty error response.",
    body_excerpt: boundedString(bodyText, 500),
    http_status: response.status,
  };
}

async function readSumUpRefundResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return {
      parsedBody: null,
      safeErrorBody: response.ok ? null : safeErrorResponseBody(response, text, null),
    };
  }

  try {
    const parsedBody = JSON.parse(text);

    return {
      parsedBody,
      safeErrorBody: response.ok ? null : safeErrorResponseBody(response, text, parsedBody),
    };
  } catch {
    if (!response.ok) {
      return {
        parsedBody: null,
        safeErrorBody: safeErrorResponseBody(response, text, null),
      };
    }

    throw new Error(text.slice(0, 500));
  }
}

function getSumUpApiKey() {
  const apiKey = process.env.SUMUP_API_KEY;

  if (!apiKey) {
    throw new Error("SUMUP_API_KEY is required.");
  }

  return apiKey;
}

function getSumUpMerchantCode() {
  const merchantCode = process.env.SUMUP_MERCHANT_CODE;

  if (!merchantCode) {
    throw new Error("SUMUP_MERCHANT_CODE is required.");
  }

  return merchantCode;
}

function getSumUpErrorMessage(responseBody: any, fallback: string) {
  return responseBody?.message || responseBody?.error_message || responseBody?.detail || responseBody?.title || fallback;
}

function normalizeMoneyAmount(amount: number | string | null | undefined) {
  return Math.round(Number(amount ?? 0) * 100);
}

function normalizeRefundAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("SumUp refund amount must be greater than 0.");
  }

  return Number((Math.round(amount * 100) / 100).toFixed(2));
}

function isPaidCompatibleTransactionStatus(transaction: Pick<SumUpTransaction, "status" | "simple_status">) {
  const status = transaction.status?.toUpperCase();
  const simpleStatus = transaction.simple_status?.toUpperCase();

  return (
    status === "SUCCESSFUL" ||
    status === "REFUNDED" ||
    simpleStatus === "SUCCESSFUL" ||
    simpleStatus === "PAID_OUT" ||
    simpleStatus === "REFUNDED"
  );
}

function validateResolvedTransactionForPayment(
  payment: BookingPaymentForSumUpResolution,
  transaction: SumUpTransaction
) {
  const transactionCode = payment.transaction_code?.trim();

  if (!transaction.id) {
    throw new Error("SumUp transaction response did not include a transaction id.");
  }

  if (!transactionCode || transaction.transaction_code !== transactionCode) {
    throw new Error("SumUp transaction code did not match the booking payment.");
  }

  if (normalizeMoneyAmount(transaction.amount) !== normalizeMoneyAmount(payment.amount)) {
    throw new Error("SumUp transaction amount did not match the booking payment.");
  }

  if (transaction.currency?.toUpperCase() !== (payment.currency || "GBP").toUpperCase()) {
    throw new Error("SumUp transaction currency did not match the booking payment.");
  }

  if (!isPaidCompatibleTransactionStatus(transaction)) {
    throw new Error("SumUp transaction is not in a paid-compatible status.");
  }
}

function withOptionalSumUpTransactionId<T extends Record<string, unknown>>(
  payload: T,
  sumupTransactionId: string | null
) {
  return sumupTransactionId ? { ...payload, sumup_transaction_id: sumupTransactionId } : payload;
}

async function resolveSumUpTransactionIdForFinalizedPayment(
  payment: BookingPaymentForSumUpResolution,
  transactionCode: string | undefined
) {
  try {
    const transaction = await resolveAndStoreSumUpTransactionIdForPayment({
      ...payment,
      transaction_code: transactionCode || payment.transaction_code,
    });

    return transaction?.id ?? payment.sumup_transaction_id ?? null;
  } catch (error) {
    console.warn(
      "Unable to resolve SumUp transaction id for booking payment:",
      error instanceof Error ? error.message : error
    );
    return payment.sumup_transaction_id ?? null;
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
  const merchantCode = getSumUpMerchantCode();

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

export async function retrieveSumUpTransactionByCode(transactionCode: string) {
  const normalizedTransactionCode = transactionCode.trim();

  if (!normalizedTransactionCode) {
    throw new Error("SumUp transaction code is required.");
  }

  const merchantCode = getSumUpMerchantCode();
  const url = new URL(`${sumupApiRoot}/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions`);
  url.searchParams.set("transaction_code", normalizedTransactionCode);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/problem+json, application/json",
      Authorization: `Bearer ${getSumUpApiKey()}`,
    },
  });

  const transaction = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getSumUpErrorMessage(transaction, "Unable to retrieve SumUp transaction."));
  }

  if (!transaction || !transaction.id || !transaction.transaction_code) {
    throw new Error("SumUp returned an invalid transaction response.");
  }

  return transaction as SumUpTransaction;
}

export async function refundSumUpTransaction(params: {
  transactionId: string;
  amount: number;
}) {
  const transactionId = params.transactionId.trim();

  if (!transactionId) {
    throw new Error("SumUp transaction id is required.");
  }

  const refundAmount = normalizeRefundAmount(params.amount);
  const merchantCode = getSumUpMerchantCode();
  const url = `${sumupApiRoot}/v1.0/merchants/${encodeURIComponent(merchantCode)}/payments/${encodeURIComponent(transactionId)}/refunds`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/problem+json, application/json",
        Authorization: `Bearer ${getSumUpApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: refundAmount,
      }),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unable to reach SumUp refund endpoint.");
  }

  const { parsedBody: refundResponse, safeErrorBody } = await readSumUpRefundResponse(response);

  if (!response.ok) {
    throw new SumUpRefundHttpError(
      getSumUpErrorMessage(safeErrorBody, "Unable to refund SumUp transaction."),
      response.status,
      safeErrorBody
    );
  }

  return {
    transactionId,
    amount: refundAmount,
    response: refundResponse as SumUpRefundResponse | null,
  } satisfies SumUpRefundResult;
}

export async function resolveAndStoreSumUpTransactionIdForPaymentId(bookingPaymentId: number) {
  if (!Number.isInteger(bookingPaymentId) || bookingPaymentId <= 0) {
    throw new Error("Booking payment id is required.");
  }

  const { data: payment, error } = await supabaseAdmin
    .from("booking_payments")
    .select("id,amount,currency,payment_status,transaction_code,sumup_transaction_id")
    .eq("id", bookingPaymentId)
    .maybeSingle<BookingPaymentForSumUpResolution>();

  if (error) {
    throw error;
  }

  if (!payment) {
    throw new Error("Booking payment was not found.");
  }

  const transaction = await resolveAndStoreSumUpTransactionIdForPayment(payment);

  return transaction?.id ?? payment.sumup_transaction_id?.trim() ?? null;
}

export async function resolveAndStoreSumUpTransactionIdForPayment(
  payment: BookingPaymentForSumUpResolution
) {
  if (payment.sumup_transaction_id?.trim()) {
    return null;
  }

  const paymentStatus = payment.payment_status?.toLowerCase();

  if (paymentStatus !== "paid" && paymentStatus !== "paid_no_space") {
    return null;
  }

  const transactionCode = payment.transaction_code?.trim();

  if (!transactionCode) {
    return null;
  }

  const transaction = await retrieveSumUpTransactionByCode(transactionCode);

  validateResolvedTransactionForPayment(payment, transaction);

  const { error } = await supabaseAdmin
    .from("booking_payments")
    .update({
      sumup_transaction_id: transaction.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  if (error) {
    throw error;
  }

  return transaction;
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

  const sumupTransactionId = await resolveSumUpTransactionIdForFinalizedPayment(payment, transactionCode);

  if (payment.booking_id) {
    const { error: updateError } = await supabaseAdmin
      .from("booking_payments")
      .update(
        withOptionalSumUpTransactionId(
          {
            payment_status: "paid",
            raw_checkout: checkout,
            transaction_code: transactionCode,
            updated_at: new Date().toISOString(),
          },
          sumupTransactionId
        )
      )
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
        .update(
          withOptionalSumUpTransactionId(
            {
              booking_id: null,
              payment_status: "paid_no_space",
              raw_checkout: checkout,
              transaction_code: transactionCode,
              updated_at: new Date().toISOString(),
            },
            sumupTransactionId
          )
        )
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
    .update(
      withOptionalSumUpTransactionId(
        {
          booking_id: bookingId,
          payment_status: "paid",
          raw_checkout: checkout,
          transaction_code: transactionCode,
          updated_at: new Date().toISOString(),
        },
        sumupTransactionId
      )
    )
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

  await runPostBookingActions({
    bookingId,
    userId: payment.user_id,
    gameId: payment.game_id,
    playerName: payment.player_name,
    bookingConfirmation: {
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      checkoutId: payment.checkout_id,
      checkoutReference: payment.checkout_reference,
    },
  });

  return { paymentStatus: "paid", bookingId };
}
