import { beforeEach, describe, expect, it, vi } from "vitest";

const assertSupabaseAdminConfiguredMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const cancelPlayerBookingWithRefundPolicyMock = vi.hoisted(() => vi.fn());
const notifyWaitingListForOpenSpaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: assertSupabaseAdminConfiguredMock,
  supabaseAdmin: {
    auth: {
      getUser: getUserMock,
    },
  },
}));

vi.mock("@/lib/playerBookingCancellation", () => ({
  cancelPlayerBookingWithRefundPolicy: cancelPlayerBookingWithRefundPolicyMock,
}));

vi.mock("@/lib/waitingListNotifications", () => ({
  notifyWaitingListForOpenSpace: notifyWaitingListForOpenSpaceMock,
}));

import { DELETE } from "@/app/api/bookings/[id]/route";

function cancellationResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    status: 200,
    message: "Booking Cancelled\n\n£8.00 has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.",
    bookingId: 100,
    gameId: 10,
    released: true,
    refundEligible: true,
    paymentMethod: "wallet",
    refundPolicy: "eligible_24h",
    sourceCreditTransactionId: 700,
    refundRequestId: null,
    walletRestorationTransactionId: 700,
    amount: 8,
    currency: "GBP",
    reason: null,
    shouldNotifyWaitingList: false,
    automaticRefund: {
      status: "not_applicable",
      message: "Wallet credit added. You can request a refund from your Wallet.",
    },
    ...overrides,
  };
}

function request() {
  return new Request("http://localhost/api/bookings/100", {
    method: "DELETE",
    headers: {
      Authorization: "Bearer token",
    },
  });
}

async function deleteBooking(id = "100") {
  return DELETE(request() as Parameters<typeof DELETE>[0], {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  cancelPlayerBookingWithRefundPolicyMock.mockResolvedValue(cancellationResult());
  notifyWaitingListForOpenSpaceMock.mockResolvedValue({ notifiedCount: 1 });
});

describe("player booking cancellation route", () => {
  it("requires an authenticated player", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const response = await deleteBooking();

    expect(response.status).toBe(401);
    expect(cancelPlayerBookingWithRefundPolicyMock).not.toHaveBeenCalled();
  });

  it("uses the refund-policy RPC helper instead of directly deleting bookings", async () => {
    const response = await deleteBooking();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cancelPlayerBookingWithRefundPolicyMock).toHaveBeenCalledWith({
      bookingId: 100,
      userId: "user-1",
    });
    expect(body).toMatchObject({
      ok: true,
      message: "Booking Cancelled\n\n£8.00 has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.",
      released: true,
      refund_eligible: true,
      payment_method: "wallet",
      wallet_restoration_transaction_id: 700,
    });
  });

  it("returns safe support-required messages without releasing the booking", async () => {
    cancelPlayerBookingWithRefundPolicyMock.mockResolvedValue(
      cancellationResult({
        success: false,
        status: 409,
        message: "This booking needs support to cancel because the kickoff time is not fully confirmed. Please contact Fair Play Football.",
        released: false,
        refundEligible: false,
        reason: "missing_starts_at",
        shouldNotifyWaitingList: false,
      })
    );

    const response = await deleteBooking();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "This booking needs support to cancel because the kickoff time is not fully confirmed. Please contact Fair Play Football.",
      reason: "missing_starts_at",
    });
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });

  it("notifies waiting list only after the helper reports the booking was released", async () => {
    cancelPlayerBookingWithRefundPolicyMock.mockResolvedValue(
      cancellationResult({
        shouldNotifyWaitingList: true,
      })
    );

    const response = await deleteBooking();

    expect(response.status).toBe(200);
    expect(notifyWaitingListForOpenSpaceMock).toHaveBeenCalledWith(10);
  });

  it("does not notify waiting list if the booking was not released", async () => {
    cancelPlayerBookingWithRefundPolicyMock.mockResolvedValue(
      cancellationResult({
        released: false,
        shouldNotifyWaitingList: true,
      })
    );

    const response = await deleteBooking();

    expect(response.status).toBe(200);
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });

  it("does not expose raw cancellation errors to the player", async () => {
    cancelPlayerBookingWithRefundPolicyMock.mockRejectedValue(
      new Error("internal database detail")
    );

    const response = await deleteBooking();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Unable to cancel this booking. Please contact Fair Play Football.",
    });
    expect(notifyWaitingListForOpenSpaceMock).not.toHaveBeenCalled();
  });
});
