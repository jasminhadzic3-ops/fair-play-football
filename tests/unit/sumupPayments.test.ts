import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const removeWaitingListEntryForBookedUserMock = vi.hoisted(() => vi.fn());
const runPostBookingActionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/postBookingActions", () => ({
  removeWaitingListEntryForBookedUser: removeWaitingListEntryForBookedUserMock,
  runPostBookingActions: runPostBookingActionsMock,
}));

import {
  finalizeCheckoutPayment,
  resolveAndStoreSumUpTransactionIdForPayment,
  retrieveSumUpTransactionByCode,
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

const updateCalls: Array<Record<string, unknown>> = [];
let paymentRow: PaymentRow | null = null;

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

function okJson(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorJson(body: Record<string, unknown>, status = 400) {
  return new Response(JSON.stringify(body), { status });
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
  paymentRow = null;
  process.env.SUMUP_API_KEY = "sumup-key";
  process.env.SUMUP_MERCHANT_CODE = "MERCHANT-1";
  global.fetch = vi.fn();
  supabaseFromMock.mockImplementation((table: string) => {
    if (table !== "booking_payments") {
      throw new Error(`Unexpected table ${table}`);
    }

    return new MockBookingPaymentsQuery();
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
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      payment_status: "paid",
      transaction_code: "TXN-1",
    });
    expect(updateCalls[0]).not.toHaveProperty("sumup_transaction_id");
    expect(removeWaitingListEntryForBookedUserMock).toHaveBeenCalledWith("user-1", 10);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
