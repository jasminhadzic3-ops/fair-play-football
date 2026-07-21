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
  events?: SumUpTransactionEvent[];
  history?: SumUpTransactionEvent[];
  transaction_events?: SumUpTransactionEvent[];
  refunds?: SumUpTransactionEvent[];
  refund_events?: SumUpTransactionEvent[];
  [key: string]: unknown;
};

export type SumUpTransactionEvent = {
  id?: string;
  type?: string;
  event_type?: string;
  status?: string;
  simple_status?: string;
  amount?: number | string;
  currency?: string;
  timestamp?: string;
  created_at?: string;
  transaction_id?: string;
  [key: string]: unknown;
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
const duplicatePaymentMessage = "This payment needs manual reconciliation before the booking can be confirmed.";

type FinalizePaidCheckoutResult = {
  success: boolean;
  payment_status: string | null;
  booking_id: number | null;
  reason: string | null;
  already_finalized: boolean | null;
};

type BookingPaymentForSumUpResolution = {
  id: number;
  amount: number | string;
  currency: string | null;
  payment_status?: string | null;
  transaction_code?: string | null;
  sumup_transaction_id?: string | null;
};

type SumUpTransactionLookupParams = {
  id?: string | null;
  transactionCode?: string | null;
};

export class SumUpTransactionLookupError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SumUpTransactionLookupError";
    this.status = status;
  }
}

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

const refundEndpointFamily = "transactions_refund_v1_merchant_payment";

function getResponseBodyKind(response: Response, parsedBody: unknown, bodyText: string) {
  if (!bodyText) {
    return "empty";
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/problem+json")) {
    return "problem_json";
  }

  if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
    return "json";
  }

  return "non_json";
}

function safeErrorResponseBody(response: Response, bodyText: string, parsedBody: unknown) {
  if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
    const body = parsedBody as Record<string, unknown>;

    return {
      upstream_http_status: response.status,
      endpoint_family: refundEndpointFamily,
      response_body_kind: getResponseBodyKind(response, parsedBody, bodyText),
      problem_type: boundedString(body.type),
      title: boundedString(body.title),
      detail: boundedString(body.detail),
      error_code: boundedString(body.error_code ?? body.code, 100),
      code: boundedString(body.code, 100),
      safe_message: boundedString(body.message ?? body.error_message ?? body.detail ?? body.title),
      message: boundedString(body.message),
      error_message: boundedString(body.error_message),
      status: boundedString(body.status, 100),
      amount: Number.isFinite(Number(body.amount)) ? Number(body.amount) : null,
      currency: boundedString(body.currency, 20),
      http_status: response.status,
    };
  }

  return {
    upstream_http_status: response.status,
    endpoint_family: refundEndpointFamily,
    response_body_kind: getResponseBodyKind(response, parsedBody, bodyText),
    problem_type: null,
    title: null,
    detail: null,
    error_code: null,
    code: null,
    safe_message: bodyText.trim()
      ? "SumUp returned a non-JSON error response."
      : "SumUp returned an empty error response.",
    message: bodyText.trim()
      ? "SumUp returned a non-JSON error response."
      : "SumUp returned an empty error response.",
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
  const transactionId = payment.sumup_transaction_id?.trim();

  if (!transaction.id) {
    throw new Error("SumUp transaction response did not include a transaction id.");
  }

  if (transactionId && transaction.id !== transactionId) {
    throw new Error("SumUp transaction id did not match the booking payment.");
  }

  if (transactionCode && transaction.transaction_code !== transactionCode) {
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

async function resolveSumUpTransactionIdForFinalizedPayment(
  payment: BookingPaymentForSumUpResolution,
  transactionCode: string | undefined
) {
  try {
    if (payment.sumup_transaction_id?.trim()) {
      return payment.sumup_transaction_id;
    }

    const transactionCodeForLookup = transactionCode || payment.transaction_code?.trim();

    if (!transactionCodeForLookup) {
      return null;
    }

    const transaction = await retrieveSumUpTransactionByCode(transactionCodeForLookup);

    validateResolvedTransactionForPayment(
      {
        ...payment,
        payment_status: "paid",
        transaction_code: transactionCodeForLookup,
      },
      transaction
    );

    return transaction.id;
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

function getTransactionLookupValue(params: SumUpTransactionLookupParams) {
  const id = params.id?.trim();
  const transactionCode = params.transactionCode?.trim();

  if (id) {
    return {
      parameter: "id",
      value: id,
    };
  }

  if (transactionCode) {
    return {
      parameter: "transaction_code",
      value: transactionCode,
    };
  }

  return null;
}

export async function retrieveSumUpTransaction(params: SumUpTransactionLookupParams) {
  const lookup = getTransactionLookupValue(params);

  if (!lookup) {
    throw new Error("SumUp transaction code is required.");
  }

  const merchantCode = getSumUpMerchantCode();
  const url = new URL(`${sumupApiRoot}/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions`);
  url.searchParams.set(lookup.parameter, lookup.value);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/problem+json, application/json",
      Authorization: `Bearer ${getSumUpApiKey()}`,
    },
  });

  const transaction = await readJsonResponse(response);

  if (!response.ok) {
    throw new SumUpTransactionLookupError(
      getSumUpErrorMessage(transaction, "Unable to retrieve SumUp transaction."),
      response.status
    );
  }

  if (!transaction || !transaction.id || !transaction.transaction_code) {
    throw new Error("SumUp returned an invalid transaction response.");
  }

  return transaction as SumUpTransaction;
}

export async function retrieveSumUpTransactionByCode(transactionCode: string) {
  return retrieveSumUpTransaction({ transactionCode });
}

export async function retrieveValidatedSumUpTransactionForPayment(
  payment: BookingPaymentForSumUpResolution
) {
  const transactionId = payment.sumup_transaction_id?.trim();
  const transactionCode = payment.transaction_code?.trim();

  if (!transactionId && !transactionCode) {
    throw new Error("SumUp transaction code is required.");
  }

  if (transactionId) {
    try {
      const transaction = await retrieveSumUpTransaction({ id: transactionId });
      validateResolvedTransactionForPayment(payment, transaction);
      return transaction;
    } catch (error) {
      if (!(error instanceof SumUpTransactionLookupError) || error.status !== 404 || !transactionCode) {
        throw error;
      }
    }
  }

  const transaction = await retrieveSumUpTransaction({ transactionCode });
  validateResolvedTransactionForPayment(
    transactionId ? { ...payment, sumup_transaction_id: null } : payment,
    transaction
  );
  return transaction;
}

export async function refundSumUpTransaction(params: {
  transactionId: string;
  amount: number;
  originalPaymentAmount: number;
}) {
  const transactionId = params.transactionId.trim();

  if (!transactionId) {
    throw new Error("SumUp transaction id is required.");
  }

  const refundAmount = normalizeRefundAmount(params.amount);
  const originalPaymentAmount = normalizeRefundAmount(params.originalPaymentAmount);

  if (refundAmount > originalPaymentAmount) {
    throw new Error("SumUp refund amount cannot exceed the original payment amount.");
  }

  const isFullRefund = refundAmount === originalPaymentAmount;
  const merchantCode = getSumUpMerchantCode();
  const url = `${sumupApiRoot}/v1.0/merchants/${encodeURIComponent(merchantCode)}/payments/${encodeURIComponent(transactionId)}/refunds`;
  const headers: Record<string, string> = {
    Accept: "application/problem+json, application/json",
    Authorization: `Bearer ${getSumUpApiKey()}`,
  };

  const requestInit: RequestInit = {
    method: "POST",
    headers,
  };

  if (!isFullRefund) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify({
      amount: refundAmount,
    });
  }

  let response: Response;

  try {
    response = await fetch(url, requestInit);
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

  const transaction = await retrieveValidatedSumUpTransactionForPayment(payment);

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

  if (payment.payment_status === "duplicate_paid") {
    return {
      paymentStatus: "duplicate_paid",
      bookingId: null,
      reason: "already_duplicate_payment_detected",
      message: duplicatePaymentMessage,
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

  const { data: finalizationResult, error: finalizationError } = await supabaseAdmin
    .rpc("finalize_paid_sumup_checkout", {
      p_checkout_id: payment.checkout_id,
      p_expected_user_id: payment.user_id,
      p_expected_game_id: payment.game_id,
      p_expected_player_name: payment.player_name,
      p_raw_checkout: checkout,
      p_transaction_code: transactionCode ?? null,
      p_sumup_transaction_id: sumupTransactionId,
    })
    .single<FinalizePaidCheckoutResult>();

  if (finalizationError) {
    throw finalizationError;
  }

  if (!finalizationResult?.success) {
    throw new Error(`Unable to finalize paid checkout: ${finalizationResult?.reason || "unknown_reason"}.`);
  }

  if (finalizationResult.payment_status === "paid_no_space") {
    return {
      paymentStatus: "paid_no_space",
      bookingId: null,
      reason: finalizationResult.reason || "game_full",
      message: noSpacePaymentMessage,
    };
  }

  if (finalizationResult.payment_status === "duplicate_paid") {
    return {
      paymentStatus: "duplicate_paid",
      bookingId: null,
      reason: finalizationResult.reason || "duplicate_payment_detected",
      message: duplicatePaymentMessage,
    };
  }

  const bookingId = finalizationResult.booking_id;

  if (finalizationResult.payment_status !== "paid" || !bookingId) {
    throw new Error("Unable to finalize paid checkout with a booking.");
  }

  if (finalizationResult.already_finalized) {
    await removeWaitingListEntryForBookedUser(payment.user_id, payment.game_id);
  } else {
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
  }

  return { paymentStatus: "paid", bookingId };
}
