import "server-only";

import { getAutomaticSumUpRefundMode } from "@/lib/sumupRefundCapabilities";
import {
  refundSumUpTransaction,
  SumUpRefundHttpError,
  type retrieveValidatedSumUpTransactionForPayment,
  type resolveAndStoreSumUpTransactionIdForPaymentId,
} from "@/lib/sumupPayments";
import type { ProcessAutomaticSumUpRefundParams, SumUpRefundDependency } from "@/lib/sumupRefundProcessing";

type AutomaticRefundProcessorDependencies = Pick<
  ProcessAutomaticSumUpRefundParams,
  "refundDependency" | "resolveTransactionId" | "retrieveValidatedTransaction"
>;

export function getTestOnlyMockRefundDependency(): SumUpRefundDependency {
  return async ({ transactionId, amount }) => {
    const outcome = process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME || "succeeded";

    if (outcome === "failed") {
      return {
        outcome: "failed",
        errorMessage: "Mocked SumUp refund failure.",
        response: {
          error_message: "Mocked SumUp refund failure.",
          transaction_id: transactionId,
          amount,
        },
      };
    }

    if (outcome === "unknown") {
      return {
        outcome: "unknown",
        errorMessage: "Mocked ambiguous SumUp refund outcome.",
        response: {
          transaction_id: transactionId,
          amount,
          status: "UNKNOWN",
        },
      };
    }

    return {
      outcome: "succeeded",
      response: {
        id: `mock-refund-${transactionId}`,
        status: "SUCCESSFUL",
        transaction_id: transactionId,
        amount,
      },
    };
  };
}

function isAmbiguousSumUpRefundHttpStatus(status: number) {
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 429;
}

function safeRefundHttpErrorResponse(error: SumUpRefundHttpError) {
  if (error.responseBody && typeof error.responseBody === "object") {
    return error.responseBody as Record<string, unknown>;
  }

  return {
    message: error.message,
    status: error.status,
  };
}

export function getRealSumUpRefundDependency(): SumUpRefundDependency {
  return async ({ transactionId, amount, originalPaymentAmount }) => {
    try {
      const result = await refundSumUpTransaction({
        transactionId,
        amount,
        originalPaymentAmount,
      });

      return {
        outcome: "succeeded",
        response: result.response,
      };
    } catch (error) {
      if (error instanceof SumUpRefundHttpError) {
        const response = safeRefundHttpErrorResponse(error);

        if (isAmbiguousSumUpRefundHttpStatus(error.status)) {
          return {
            outcome: "unknown",
            errorMessage: error.message,
            response,
          };
        }

        return {
          outcome: "failed",
          errorMessage: error.message,
          response,
        };
      }

      return {
        outcome: "unknown",
        errorMessage: error instanceof Error ? error.message : "Unknown SumUp refund outcome.",
        response: null,
      };
    }
  };
}

export function getAutomaticRefundDependency(): SumUpRefundDependency | null {
  const mode = getAutomaticSumUpRefundMode();

  if (mode === "test_mock") {
    return getTestOnlyMockRefundDependency();
  }

  if (mode === "local_sandbox_real" || mode === "production_real") {
    return getRealSumUpRefundDependency();
  }

  return null;
}

function getTestOnlyMockResolveTransactionId(): typeof resolveAndStoreSumUpTransactionIdForPaymentId {
  return async (bookingPaymentId) => `mock-sumup-transaction-${bookingPaymentId}`;
}

function getTestOnlyMockValidatedTransaction(): typeof retrieveValidatedSumUpTransactionForPayment {
  return async (payment) => {
    const paymentStatus = payment.payment_status?.toLowerCase();

    if (paymentStatus !== "paid" && paymentStatus !== "paid_no_space") {
      throw new Error("Only paid SumUp payments can be refunded.");
    }

    const amount = Number(payment.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid SumUp payment amount.");
    }

    const transactionId =
      payment.sumup_transaction_id?.trim() ||
      (payment.transaction_code?.trim()
        ? `mock-sumup-transaction-${payment.transaction_code.trim()}`
        : null);

    if (!transactionId) {
      throw new Error("SumUp transaction code is required.");
    }

    return {
      id: transactionId,
      transaction_code: payment.transaction_code?.trim() || `mock-code-${payment.id}`,
      amount,
      currency: payment.currency || "GBP",
      status: "SUCCESSFUL",
    };
  };
}

export function getAutomaticRefundProcessorDependencies(): AutomaticRefundProcessorDependencies | null {
  const mode = getAutomaticSumUpRefundMode();
  const refundDependency = getAutomaticRefundDependency();

  if (!refundDependency) {
    return null;
  }

  if (mode === "test_mock") {
    return {
      refundDependency,
      resolveTransactionId: getTestOnlyMockResolveTransactionId(),
      retrieveValidatedTransaction: getTestOnlyMockValidatedTransaction(),
    };
  }

  return { refundDependency };
}
