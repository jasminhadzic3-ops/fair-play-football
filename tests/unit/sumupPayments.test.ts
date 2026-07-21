import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const supabaseRpcMock = vi.hoisted(() => vi.fn());
const removeWaitingListEntryForBookedUserMock = vi.hoisted(() => vi.fn());
const runPostBookingActionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: {
    from: supabaseFromMock,
    rpc: supabaseRpcMock,
  },
}));

vi.mock("@/lib/postBookingActions", () => ({
  removeWaitingListEntryForBookedUser: removeWaitingListEntryForBookedUserMock,
  runPostBookingActions: runPostBookingActionsMock,
}));

import {
  finalizeCheckoutPayment,
  refundSumUpTransaction,
  resolveAndStoreSumUpTransactionIdForPayment,
  retrieveValidatedSumUpTransactionForPayment,
  retrieveSumUpTransaction,
  retrieveSumUpTransactionByCode,
  SumUpRefundHttpError,
} from "@/lib/sumupPayments";

type PaymentRow = {
  id: number;
  user_id: string;
  game_id: number;
  player_name: string;
  checkout_id: string;
  checkout_reference: string;
  payment_status: string;
  booking_id: number | null;
  amount: number;
  currency: string;
  transaction_code?: string | null;
  sumup_transaction_id?: string | null;
};

type RpcResult = {
  success: boolean;
  payment_status: string | null;
  booking_id: number | null;
  reason: string | null;
  already_finalized: boolean | null;
};

const updateCalls: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
let paymentRow: PaymentRow | null = null;
let rpcResult: RpcResult | null = null;
let rpcError: Error | null = null;

class MockBookingPaymentsQuery {
  private updatePayload: Record<string, unknown> | null = null;

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload;
    updateCalls.push(payload);
    return this;
  }

  eq() {
    return this;
  }

  is() {
    return this;
  }

  async maybeSingle<T>() {
    if (this.updatePayload) {
      return {
        data: {
          booking_id: this.updatePayload.booking_id ?? paymentRow?.booking_id ?? null,
          payment_status: this.updatePayload.payment_status ?? paymentRow?.payment_status ?? null,
        } as T,
        error: null,
      };
    }

    return { data: paymentRow as T | null, error: null };
  }

  async single<T>() {
    return {
      data: {
        booking_id: paymentRow?.booking_id ?? null,
        payment_status: paymentRow?.payment_status ?? null,
      } as T,
      error: null,
    };
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

class MockRpcQuery {
  async single<T>() {
    return {
      data: rpcResult as T | null,
      error: rpcError,
    };
  }
}

function okJson(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorJson(body: Record<string, unknown>, status = 400) {
  return new Response(JSON.stringify(body), { status });
}

function problemJson(body: Record<string, unknown>, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
}

function defaultPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 44,
    user_id: "user-1",
    game_id: 10,
    player_name: "Player One",
    checkout_id: "checkout-1",
    checkout_reference: "reference-1",
    payment_status: "paid",
    booking_id: 123,
    amount: 10,
    currency: "GBP",
    transaction_code: "TXN-1",
    sumup_transaction_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  updateCalls.length = 0;
  rpcCalls.length = 0;
  paymentRow = null;
  rpcResult = {
    success: true,
    payment_status: "paid",
    booking_id: 123,
    reason: null,
    already_finalized: false,
  };
  rpcError = null;
  process.env.SUMUP_API_KEY = "sumup-key";
  process.env.SUMUP_MERCHANT_CODE = "MERCHANT-1";
  global.fetch = vi.fn();
  supabaseFromMock.mockImplementation((table: string) => {
    if (table !== "booking_payments") {
      throw new Error(`Unexpected table ${table}`);
    }

    return new MockBookingPaymentsQuery();
  });
  supabaseRpcMock.mockImplementation((name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params });
    return new MockRpcQuery();
  });
});

describe("SumUp payment helpers", () => {
  it("retrieves a SumUp transaction by transaction code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    const transaction = await retrieveSumUpTransactionByCode("TXN-1");

    expect(transaction).toMatchObject({
      id: "transaction-id-1",
      transaction_code: "TXN-1",
      amount: 10,
      currency: "GBP",
      status: "SUCCESSFUL",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?transaction_code=TXN-1",
      {
        headers: {
          Accept: "application/problem+json, application/json",
          Authorization: "Bearer sumup-key",
        },
      }
    );
  });

  it("retrieves a SumUp transaction by transaction id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    const transaction = await retrieveSumUpTransaction({ id: "transaction-id-1" });

    expect(transaction.id).toBe("transaction-id-1");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?id=transaction-id-1",
      {
        headers: {
          Accept: "application/problem+json, application/json",
          Authorization: "Bearer sumup-key",
        },
      }
    );
  });

  it("requires SumUp transaction lookup env vars", async () => {
    delete process.env.SUMUP_MERCHANT_CODE;

    await expect(retrieveSumUpTransactionByCode("TXN-1")).rejects.toThrow("SUMUP_MERCHANT_CODE is required.");

    process.env.SUMUP_MERCHANT_CODE = "MERCHANT-1";
    delete process.env.SUMUP_API_KEY;

    await expect(retrieveSumUpTransactionByCode("TXN-1")).rejects.toThrow("SUMUP_API_KEY is required.");
  });

  it("surfaces non-OK SumUp transaction lookup responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorJson({ detail: "No transaction found." }, 404));

    await expect(retrieveSumUpTransactionByCode("TXN-404")).rejects.toThrow("No transaction found.");
  });

  it("prefers stored SumUp transaction id for validated payment lookup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    const transaction = await retrieveValidatedSumUpTransactionForPayment(
      defaultPayment({ sumup_transaction_id: "transaction-id-1" })
    );

    expect(transaction.id).toBe("transaction-id-1");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?id=transaction-id-1",
      expect.any(Object)
    );
  });

  it("validates an id-only SumUp transaction when no transaction code is stored", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    const transaction = await retrieveValidatedSumUpTransactionForPayment(
      defaultPayment({
        transaction_code: null,
        sumup_transaction_id: "transaction-id-1",
      })
    );

    expect(transaction.id).toBe("transaction-id-1");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?id=transaction-id-1",
      expect.any(Object)
    );
  });

  it("falls back to transaction code when stored SumUp transaction id is not found", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorJson({ detail: "No transaction found." }, 404))
      .mockResolvedValueOnce(
        okJson({
          id: "transaction-id-1",
          transaction_code: "TXN-1",
          amount: 10,
          currency: "GBP",
          status: "SUCCESSFUL",
        })
      );

    const transaction = await retrieveValidatedSumUpTransactionForPayment(
      defaultPayment({ sumup_transaction_id: "stale-transaction-id" })
    );

    expect(transaction.id).toBe("transaction-id-1");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?id=stale-transaction-id",
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.sumup.com/v2.1/merchants/MERCHANT-1/transactions?transaction_code=TXN-1",
      expect.any(Object)
    );
  });

  it("rejects a SumUp transaction id mismatch before reconciliation use", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "different-transaction-id",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    await expect(
      retrieveValidatedSumUpTransactionForPayment(
        defaultPayment({ sumup_transaction_id: "transaction-id-1" })
      )
    ).rejects.toThrow("SumUp transaction id did not match the booking payment.");
  });

  it("rejects a SumUp transaction code mismatch before reconciliation use", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-2",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    await expect(retrieveValidatedSumUpTransactionForPayment(defaultPayment())).rejects.toThrow(
      "SumUp transaction code did not match the booking payment."
    );
  });

  it("rejects amount and currency mismatches before reconciliation use", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okJson({
          id: "transaction-id-1",
          transaction_code: "TXN-1",
          amount: 12,
          currency: "GBP",
          status: "SUCCESSFUL",
        })
      )
      .mockResolvedValueOnce(
        okJson({
          id: "transaction-id-1",
          transaction_code: "TXN-1",
          amount: 10,
          currency: "EUR",
          status: "SUCCESSFUL",
        })
      );

    await expect(retrieveValidatedSumUpTransactionForPayment(defaultPayment())).rejects.toThrow(
      "SumUp transaction amount did not match the booking payment."
    );
    await expect(retrieveValidatedSumUpTransactionForPayment(defaultPayment())).rejects.toThrow(
      "SumUp transaction currency did not match the booking payment."
    );
  });

  it("stores a resolved SumUp transaction id for a matching paid booking payment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 10,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    const transaction = await resolveAndStoreSumUpTransactionIdForPayment(defaultPayment());

    expect(transaction?.id).toBe("transaction-id-1");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      sumup_transaction_id: "transaction-id-1",
    });
  });

  it("rejects mismatched SumUp transaction details before storing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "transaction-id-1",
        transaction_code: "TXN-1",
        amount: 12,
        currency: "GBP",
        status: "SUCCESSFUL",
      })
    );

    await expect(resolveAndStoreSumUpTransactionIdForPayment(defaultPayment())).rejects.toThrow(
      "SumUp transaction amount did not match the booking payment."
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("does not resolve transaction ids for unpaid local booking payments", async () => {
    const transaction = await resolveAndStoreSumUpTransactionIdForPayment(
      defaultPayment({ payment_status: "pending" })
    );

    expect(transaction).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("does not break paid checkout finalisation when transaction id lookup fails", async () => {
    paymentRow = defaultPayment();
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 123,
      reason: null,
      already_finalized: true,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okJson({
          id: "checkout-1",
          status: "PAID",
          transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
        })
      )
      .mockResolvedValueOnce(errorJson({ detail: "Transaction API temporarily unavailable." }, 503));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({ paymentStatus: "paid", bookingId: 123 });
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: "finalize_paid_sumup_checkout",
      params: expect.objectContaining({
        p_checkout_id: "checkout-1",
        p_expected_user_id: "user-1",
        p_expected_game_id: 10,
        p_expected_player_name: "Player One",
        p_transaction_code: "TXN-1",
        p_sumup_transaction_id: null,
      }),
    });
    expect(removeWaitingListEntryForBookedUserMock).toHaveBeenCalledWith("user-1", 10);
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("finalizes a verified paid checkout through the atomic database RPC", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 456,
      reason: null,
      already_finalized: false,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okJson({
          id: "checkout-1",
          status: "PAID",
          transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
        })
      )
      .mockResolvedValueOnce(
        okJson({
          id: "transaction-id-1",
          transaction_code: "TXN-1",
          amount: 10,
          currency: "GBP",
          status: "SUCCESSFUL",
        })
      );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({ paymentStatus: "paid", bookingId: 456 });
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: "finalize_paid_sumup_checkout",
      params: expect.objectContaining({
        p_checkout_id: "checkout-1",
        p_expected_user_id: "user-1",
        p_expected_game_id: 10,
        p_expected_player_name: "Player One",
        p_transaction_code: "TXN-1",
        p_sumup_transaction_id: "transaction-id-1",
      }),
    });
    expect(runPostBookingActionsMock).toHaveBeenCalledWith({
      bookingId: 456,
      userId: "user-1",
      gameId: 10,
      playerName: "Player One",
      bookingConfirmation: {
        paymentId: 44,
        amount: 10,
        currency: "GBP",
        checkoutId: "checkout-1",
        checkoutReference: "reference-1",
      },
    });
  });

  it("is idempotent when the atomic RPC reports an already finalized paid booking", async () => {
    paymentRow = defaultPayment({ payment_status: "paid", booking_id: 123 });
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 123,
      reason: null,
      already_finalized: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({ paymentStatus: "paid", bookingId: 123 });
    expect(rpcCalls).toHaveLength(1);
    expect(removeWaitingListEntryForBookedUserMock).toHaveBeenCalledWith("user-1", 10);
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
  });

  it("returns one booking when duplicate finalisation requests run through the atomic RPC", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 789,
      reason: null,
      already_finalized: false,
    };
    vi.mocked(fetch).mockImplementation(async () =>
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const [firstResult, secondResult] = await Promise.all([
      finalizeCheckoutPayment("checkout-1"),
      finalizeCheckoutPayment("checkout-1"),
    ]);

    expect(firstResult).toEqual({ paymentStatus: "paid", bookingId: 789 });
    expect(secondResult).toEqual({ paymentStatus: "paid", bookingId: 789 });
    expect(rpcCalls).toHaveLength(2);
    expect(new Set(rpcCalls.map((call) => call.params.p_checkout_id))).toEqual(new Set(["checkout-1"]));
  });

  it("returns paid_no_space with no booking when the atomic RPC reports a full game", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid_no_space",
      booking_id: null,
      reason: "game_full",
      already_finalized: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({
      paymentStatus: "paid_no_space",
      bookingId: null,
      reason: "game_full",
      message: "This spot has already been taken. You are still on the waiting list.",
    });
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
  });

  it("returns paid_no_space with a cancelled-game reason when the atomic RPC reports a cancelled game", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid_no_space",
      booking_id: null,
      reason: "game_cancelled",
      already_finalized: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({
      paymentStatus: "paid_no_space",
      bookingId: null,
      reason: "game_cancelled",
      message: "This spot has already been taken. You are still on the waiting list.",
    });
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
  });

  it("returns duplicate_paid without booking side effects when the atomic RPC detects a duplicate paid checkout", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "duplicate_paid",
      booking_id: null,
      reason: "duplicate_payment_detected",
      already_finalized: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({
      paymentStatus: "duplicate_paid",
      bookingId: null,
      reason: "duplicate_payment_detected",
      message: "This payment needs manual reconciliation before the booking can be confirmed.",
    });
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
    expect(removeWaitingListEntryForBookedUserMock).not.toHaveBeenCalled();
  });

  it("keeps already detected duplicate paid checkouts idempotent", async () => {
    paymentRow = defaultPayment({ payment_status: "duplicate_paid", booking_id: null });
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({
      paymentStatus: "duplicate_paid",
      bookingId: null,
      reason: "already_duplicate_payment_detected",
      message: "This payment needs manual reconciliation before the booking can be confirmed.",
    });
    expect(rpcCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(runPostBookingActionsMock).not.toHaveBeenCalled();
    expect(removeWaitingListEntryForBookedUserMock).not.toHaveBeenCalled();
  });

  it("links an existing matching booking returned by the atomic RPC", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 321,
      reason: null,
      already_finalized: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    const result = await finalizeCheckoutPayment("checkout-1");

    expect(result).toEqual({ paymentStatus: "paid", bookingId: 321 });
    expect(runPostBookingActionsMock).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 321,
      userId: "user-1",
      gameId: 10,
    }));
  });

  it("returns a reconciliation error when the local payment row is missing", async () => {
    paymentRow = null;
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    await expect(finalizeCheckoutPayment("checkout-1")).rejects.toThrow("Payment record not found.");

    expect(rpcCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("leaves database finalisation to the RPC if post-RPC side effects fail", async () => {
    paymentRow = defaultPayment({ payment_status: "pending", booking_id: null });
    rpcResult = {
      success: true,
      payment_status: "paid",
      booking_id: 654,
      reason: null,
      already_finalized: false,
    };
    runPostBookingActionsMock.mockRejectedValueOnce(new Error("email service unavailable"));
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "checkout-1",
        status: "PAID",
        transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
      })
    );

    await expect(finalizeCheckoutPayment("checkout-1")).rejects.toThrow("email service unavailable");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("finalize_paid_sumup_checkout");
    expect(updateCalls).toHaveLength(0);
  });

  it("sends an empty request body for a full SumUp refund", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await refundSumUpTransaction({
      transactionId: "transaction-id-1",
      amount: 10,
      originalPaymentAmount: 10,
    });

    expect(result).toEqual({
      transactionId: "transaction-id-1",
      amount: 10,
      response: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v1.0/merchants/MERCHANT-1/payments/transaction-id-1/refunds",
      {
        method: "POST",
        headers: {
          Accept: "application/problem+json, application/json",
          Authorization: "Bearer sumup-key",
        },
      }
    );
  });

  it("sends an amount payload for a partial SumUp refund", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({
        id: "refund-1",
        status: "SUCCESSFUL",
        amount: 5,
        transaction_id: "transaction-id-1",
      })
    );

    const result = await refundSumUpTransaction({
      transactionId: "transaction-id-1",
      amount: 5,
      originalPaymentAmount: 10,
    });

    expect(result).toEqual({
      transactionId: "transaction-id-1",
      amount: 5,
      response: {
        id: "refund-1",
        status: "SUCCESSFUL",
        amount: 5,
        transaction_id: "transaction-id-1",
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v1.0/merchants/MERCHANT-1/payments/transaction-id-1/refunds",
      {
        method: "POST",
        headers: {
          Accept: "application/problem+json, application/json",
          Authorization: "Bearer sumup-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: 5 }),
      }
    );
  });

  it("URL-encodes merchant code and transaction id for refunds", async () => {
    process.env.SUMUP_MERCHANT_CODE = "MERCHANT / 1";
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ id: "refund-1" }));

    await refundSumUpTransaction({
      transactionId: "txn/id 1",
      amount: 1,
      originalPaymentAmount: 1,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.sumup.com/v1.0/merchants/MERCHANT%20%2F%201/payments/txn%2Fid%201/refunds",
      expect.any(Object)
    );
  });

  it("normalizes SumUp refund amounts to two decimal places", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ id: "refund-1" }));

    const result = await refundSumUpTransaction({
      transactionId: "transaction-id-1",
      amount: 10.555,
      originalPaymentAmount: 20,
    });

    expect(result.amount).toBe(10.56);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ amount: 10.56 }),
      })
    );
  });

  it("rejects invalid SumUp refund inputs before calling SumUp", async () => {
    await expect(refundSumUpTransaction({ transactionId: " ", amount: 10, originalPaymentAmount: 10 })).rejects.toThrow(
      "SumUp transaction id is required."
    );
    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 0, originalPaymentAmount: 10 })).rejects.toThrow(
      "SumUp refund amount must be greater than 0."
    );
    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: -1, originalPaymentAmount: 10 })).rejects.toThrow(
      "SumUp refund amount must be greater than 0."
    );
    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: Number.NaN, originalPaymentAmount: 10 })).rejects.toThrow(
      "SumUp refund amount must be greater than 0."
    );
    await expect(
      refundSumUpTransaction({ transactionId: "transaction-id-1", amount: Number.POSITIVE_INFINITY, originalPaymentAmount: 10 })
    ).rejects.toThrow("SumUp refund amount must be greater than 0.");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects over-refunds before calling SumUp", async () => {
    await expect(
      refundSumUpTransaction({
        transactionId: "transaction-id-1",
        amount: 10.01,
        originalPaymentAmount: 10,
      })
    ).rejects.toThrow("SumUp refund amount cannot exceed the original payment amount.");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires SumUp refund env vars", async () => {
    delete process.env.SUMUP_MERCHANT_CODE;

    await expect(
      refundSumUpTransaction({
        transactionId: "transaction-id-1",
        amount: 10,
        originalPaymentAmount: 10,
      })
    ).rejects.toThrow("SUMUP_MERCHANT_CODE is required.");

    process.env.SUMUP_MERCHANT_CODE = "MERCHANT-1";
    delete process.env.SUMUP_API_KEY;

    await expect(
      refundSumUpTransaction({
        transactionId: "transaction-id-1",
        amount: 10,
        originalPaymentAmount: 10,
      })
    ).rejects.toThrow("SUMUP_API_KEY is required.");
  });

  it("surfaces non-OK SumUp refund responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errorJson(
        {
          detail: "Refund amount is too high.",
          code: "validation_error",
          transaction_id: "transaction-id-1",
        },
        422
      )
    );

    try {
      await refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 });
      throw new Error("Expected refundSumUpTransaction to throw.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SumUpRefundHttpError",
        message: "Refund amount is too high.",
        status: 422,
        responseBody: expect.objectContaining({
          upstream_http_status: 422,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "json",
          detail: "Refund amount is too high.",
          code: "validation_error",
          error_code: "validation_error",
          safe_message: "Refund amount is too high.",
          http_status: 422,
        }),
      });
      expect((error as SumUpRefundHttpError).responseBody).not.toHaveProperty("transaction_id");
    }
  });

  it("treats non-JSON SumUp refund rejections as definite HTTP failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html>service unavailable</html>", {
        status: 503,
        headers: {
          "Content-Type": "text/html",
        },
      })
    );

    try {
      await refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 });
      throw new Error("Expected refundSumUpTransaction to throw.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SumUpRefundHttpError",
        message: "SumUp returned a non-JSON error response.",
        status: 503,
        responseBody: expect.objectContaining({
          upstream_http_status: 503,
          endpoint_family: "transactions_refund_v1_merchant_payment",
          response_body_kind: "non_json",
          safe_message: "SumUp returned a non-JSON error response.",
          http_status: 503,
        }),
      });
      expect(JSON.stringify((error as SumUpRefundHttpError).responseBody)).not.toContain("<html>");
      expect(JSON.stringify((error as SumUpRefundHttpError).responseBody)).not.toContain("transaction-id-1");
      expect(JSON.stringify((error as SumUpRefundHttpError).responseBody)).not.toContain("sumup-key");
    }
  });

  it("captures safe Problem Details diagnostics for forbidden refund responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      problemJson(
        {
          type: "https://developer.sumup.com/problem/request-not-allowed",
          title: "Request not allowed.",
          detail: "The request is authenticated but not permitted.",
          error_code: "request_not_allowed",
        },
        403
      )
    );

    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 })).rejects.toMatchObject({
      name: "SumUpRefundHttpError",
      message: "The request is authenticated but not permitted.",
      status: 403,
      responseBody: expect.objectContaining({
        upstream_http_status: 403,
        endpoint_family: "transactions_refund_v1_merchant_payment",
        response_body_kind: "problem_json",
        problem_type: "https://developer.sumup.com/problem/request-not-allowed",
        title: "Request not allowed.",
        detail: "The request is authenticated but not permitted.",
        error_code: "request_not_allowed",
        safe_message: "The request is authenticated but not permitted.",
      }),
    });
  });

  it("captures safe conflict diagnostics for rejected refund responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errorJson(
        {
          error_code: "CONFLICT",
          message: "The transaction is not refundable in its current state.",
        },
        409
      )
    );

    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 })).rejects.toMatchObject({
      name: "SumUpRefundHttpError",
      message: "The transaction is not refundable in its current state.",
      status: 409,
      responseBody: expect.objectContaining({
        upstream_http_status: 409,
        response_body_kind: "json",
        error_code: "CONFLICT",
        safe_message: "The transaction is not refundable in its current state.",
      }),
    });
  });

  it("captures safe empty-body diagnostics for rejected refund responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 422 }));

    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 })).rejects.toMatchObject({
      name: "SumUpRefundHttpError",
      message: "SumUp returned an empty error response.",
      status: 422,
      responseBody: expect.objectContaining({
        upstream_http_status: 422,
        endpoint_family: "transactions_refund_v1_merchant_payment",
        response_body_kind: "empty",
        safe_message: "SumUp returned an empty error response.",
      }),
    });
  });

  it("keeps transport failures as non-HTTP errors for unknown outcome handling", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fetch failed"));

    try {
      await refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 99, originalPaymentAmount: 100 });
      throw new Error("Expected refundSumUpTransaction to throw.");
    } catch (error) {
      expect(error).not.toBeInstanceOf(SumUpRefundHttpError);
      expect(error).toEqual(new Error("fetch failed"));
    }
  });

  it("handles an empty successful SumUp refund response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(refundSumUpTransaction({ transactionId: "transaction-id-1", amount: 5, originalPaymentAmount: 5 })).resolves.toEqual({
      transactionId: "transaction-id-1",
      amount: 5,
      response: null,
    });
  });

  it("does not call the SumUp refund endpoint during checkout finalisation", async () => {
    paymentRow = defaultPayment();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okJson({
          id: "checkout-1",
          status: "PAID",
          transactions: [{ transaction_code: "TXN-1", status: "SUCCESSFUL" }],
        })
      )
      .mockResolvedValueOnce(
        okJson({
          id: "transaction-id-1",
          transaction_code: "TXN-1",
          amount: 10,
          currency: "GBP",
          status: "SUCCESSFUL",
        })
      );

    await finalizeCheckoutPayment("checkout-1");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => {
      return String(url).includes("/refunds") || init?.method === "POST";
    })).toBe(false);
  });
});
