import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendBookingConfirmedEmailMock = vi.hoisted(() => vi.fn());
const sendEmailWithDeliveryTrackingMock = vi.hoisted(() => vi.fn());
const sendGameHalfFullEmailsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/bookingConfirmed", () => ({
  sendBookingConfirmedEmail: sendBookingConfirmedEmailMock,
}));

vi.mock("@/lib/email/deliveryTracking", () => ({
  sendEmailWithDeliveryTracking: sendEmailWithDeliveryTrackingMock,
}));

vi.mock("@/lib/email/gameHalfFull", () => ({
  sendGameHalfFullEmails: sendGameHalfFullEmailsMock,
}));

import { runPostBookingActions } from "@/lib/postBookingActions";

function mockWaitingListUpdate() {
  supabaseFromMock.mockReturnValue({
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: undefined,
  });
}

function setupTrackingWithDurableSkip() {
  const seenKeys = new Set<string>();

  sendEmailWithDeliveryTrackingMock.mockImplementation(async (params: { deliveryKey: string; send: () => Promise<unknown> }) => {
    if (seenKeys.has(params.deliveryKey)) {
      return { skipped: true, status: "sent" };
    }

    seenKeys.add(params.deliveryKey);
    await params.send();
    return { skipped: false, status: "sent" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWaitingListUpdate();
  setupTrackingWithDurableSkip();
  sendBookingConfirmedEmailMock.mockResolvedValue({ id: "email-1" });
  sendGameHalfFullEmailsMock.mockResolvedValue({ skipped: true, sentCount: 0 });
});

describe("runPostBookingActions", () => {
  it("uses one durable booking-confirmation key across duplicate webhook retries", async () => {
    const params = {
      bookingId: 123,
      userId: "user-1",
      gameId: 10,
      playerName: "Player One",
      bookingConfirmation: {
        paymentId: 456,
        amount: 8,
        currency: "GBP",
        checkoutId: "checkout-1",
        checkoutReference: "reference-1",
      },
    };

    await runPostBookingActions(params);
    await runPostBookingActions(params);

    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenCalledTimes(2);
    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        deliveryKey: "booking_confirmed:booking:123",
        emailType: "booking_confirmation",
        recipientKey: "user-1",
        bookingId: 123,
        gameId: 10,
      })
    );
    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deliveryKey: "booking_confirmed:booking:123",
      })
    );
    expect(sendBookingConfirmedEmailMock).toHaveBeenCalledTimes(1);
  });

  it("uses the same durable key for duplicate wallet booking actions", async () => {
    const params = {
      bookingId: 200,
      userId: "user-2",
      gameId: 20,
      playerName: "Wallet Player",
      bookingConfirmation: {
        paymentId: 900,
        amount: 8,
        currency: "GBP",
        checkoutId: null,
        checkoutReference: null,
      },
    };

    await runPostBookingActions(params);
    await runPostBookingActions(params);

    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryKey: "booking_confirmed:booking:200",
        metadata: {
          payment_id: 900,
        },
      })
    );
    expect(sendBookingConfirmedEmailMock).toHaveBeenCalledTimes(1);
  });
});
