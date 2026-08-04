import { beforeEach, describe, expect, it, vi } from "vitest";

const finalizeCheckoutPaymentMock = vi.hoisted(() => vi.fn());
const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  finalizeCheckoutPayment: finalizeCheckoutPaymentMock,
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { GET } from "@/app/api/sumup/checkout-status/route";

type PaymentRow = {
  user_id: string;
  game_id: number;
  checkout_id: string;
  checkout_reference: string;
  payment_status: string;
  booking_id: number | null;
};

let paymentRow: PaymentRow | null = null;

class MockPaymentQuery {
  select() {
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle<T>() {
    return { data: paymentRow as T | null, error: null };
  }
}

function statusRequest(reference = "checkout-reference") {
  const request = new Request(`http://localhost/api/sumup/status?checkout_reference=${reference}`, {
    headers: {
      Authorization: "Bearer token",
    },
  });

  return Object.assign(request, {
    nextUrl: new URL(request.url),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentRow = {
    user_id: "user-1",
    game_id: 41,
    checkout_id: "checkout-1",
    checkout_reference: "checkout-reference",
    payment_status: "pending",
    booking_id: null,
  };
  getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
  finalizeCheckoutPaymentMock.mockResolvedValue({
    paymentStatus: "expired",
    bookingId: null,
  });
  supabaseFromMock.mockReturnValue(new MockPaymentQuery());
});

describe("SumUp checkout status route", () => {
  it("returns the refreshed terminal SumUp status instead of the stale local pending status", async () => {
    const response = await GET(statusRequest() as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(finalizeCheckoutPaymentMock).toHaveBeenCalledWith("checkout-1");
    expect(body).toMatchObject({
      paymentStatus: "expired",
      bookingId: null,
      checkoutId: "checkout-1",
      gameId: 41,
    });
  });
});
