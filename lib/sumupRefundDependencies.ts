import "server-only";

import { getAutomaticSumUpRefundMode } from "@/lib/sumupRefundCapabilities";
import { refundSumUpTransaction, SumUpRefundHttpError } from "@/lib/sumupPayments";
import type { SumUpRefundDependency } from "@/lib/sumupRefundProcessing";

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
