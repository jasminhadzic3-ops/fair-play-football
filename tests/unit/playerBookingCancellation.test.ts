import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRpcMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendPlayerBookingCancelledEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: supabaseRpcMock,
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/playerBookingCancelled", () => ({
  sendPlayerBookingCancelledEmail: sendPlayerBookingCancelledEmailMock,
}));

import { cancelPlayerBookingWithRefundPolicy } from "@/lib/playerBookingCancellation";

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    booking_id: 100,
    game_id: 10,
    released: true,
    refund_eligible: true,
    payment_method: "sumup",
    refund_policy: "eligible_24h",
    source_credit_transaction_id: 700,
    refund_request_id: null,
    wallet_restoration_transaction_id: null,
    amount: 8,
    currency: "GBP",
    reason: null,
    was_full_before_release: true,
    space_available_after_release: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseRpcMock.mockResolvedValue({ data: [rpcResult()], error: null });
  supabaseFromMock.mockImplementation((table: string) => {
    if (table !== "player_booking_cancellations") {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 600 }, error: null }),
    };
  });
  sendPlayerBookingCancelledEmailMock.mockResolvedValue({ id: "email-1" });
});

describe("cancelPlayerBookingWithRefundPolicy", () => {
  it("calls the atomic cancellation RPC first", async () => {
    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(supabaseRpcMock).toHaveBeenCalledWith("cancel_player_booking_with_refund_policy", {
      p_booking_id: 100,
      p_user_id: "user-1",
    });
    expect(result).toMatchObject({
      success: true,
      released: true,
      refundEligible: true,
      paymentMethod: "sumup",
      refundRequestId: null,
      shouldNotifyWaitingList: true,
      automaticRefund: {
        status: "not_applicable",
        message: "Wallet credit added. You can request a refund from your Wallet.",
      },
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith({
      cancellationId: 600,
      bookingId: 100,
      gameId: 10,
      userId: "user-1",
      outcome: "wallet_restored",
      amount: 8,
      currency: "GBP",
    });
  });

  it("does not process an eligible SumUp cancellation automatically even if a legacy refund request id is returned", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [rpcResult({ refund_request_id: 800 })],
      error: null,
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result.automaticRefund).toMatchObject({
      status: "not_applicable",
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "wallet_restored",
      })
    );
  });

  it("does not call SumUp processing for wallet-paid cancellations", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [
        rpcResult({
          payment_method: "wallet",
          refund_request_id: null,
          wallet_restoration_transaction_id: 777,
        }),
      ],
      error: null,
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result).toMatchObject({
      message: "Booking Cancelled\n\n£8.00 has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.",
      walletRestorationTransactionId: 777,
      automaticRefund: {
        status: "not_applicable",
      },
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "wallet_restored",
      })
    );
  });

  it("does not call SumUp processing for within-24-hour cancellations", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [
        rpcResult({
          refund_eligible: false,
          refund_policy: "ineligible_within_24h",
          source_credit_transaction_id: null,
          refund_request_id: null,
          reason: "cancelled_within_24h",
        }),
      ],
      error: null,
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result).toMatchObject({
      message: "Booking cancelled. No refund is available within 24 hours of kick-off.",
      refundEligible: false,
      reason: "cancelled_within_24h",
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "no_refund_within_24h",
      })
    );
  });

  it("fails closed when the RPC blocks missing starts_at", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [
        rpcResult({
          success: false,
          released: false,
          refund_eligible: false,
          payment_method: null,
          refund_policy: "support_required",
          source_credit_transaction_id: null,
          refund_request_id: null,
          reason: "missing_starts_at",
        }),
      ],
      error: null,
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result).toMatchObject({
      success: false,
      status: 409,
      released: false,
      message: "This booking needs support to cancel because the kickoff time is not fully confirmed. Please contact Fair Play Football.",
    });
    expect(sendPlayerBookingCancelledEmailMock).not.toHaveBeenCalled();
  });

  it("returns the durable cancellation result when a concurrent duplicate sees the booking already released", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [
        rpcResult({
          success: false,
          released: false,
          refund_eligible: false,
          payment_method: null,
          refund_policy: null,
          source_credit_transaction_id: null,
          refund_request_id: null,
          reason: "booking_not_found",
        }),
      ],
      error: null,
    });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table !== "player_booking_cancellations") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            booking_id: 100,
            game_id: 10,
            payment_method: "sumup",
            refund_policy: "eligible_24h",
            status: "released",
            source_credit_transaction_id: 700,
            refund_request_id: 800,
            wallet_transaction_id: null,
            amount: 8,
            currency: "GBP",
            reason: null,
            was_full_before_release: true,
            space_available_after_release: true,
          },
          error: null,
        }),
      };
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result).toMatchObject({
      success: true,
      status: 200,
      released: true,
      refundEligible: true,
      paymentMethod: "sumup",
      refundRequestId: 800,
      automaticRefund: {
        status: "not_applicable",
      },
    });
    expect(sendPlayerBookingCancelledEmailMock).not.toHaveBeenCalled();
  });

  it("uses the durable cancellation id for duplicate cancellation email idempotency", async () => {
    await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledTimes(2);
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cancellationId: 600, outcome: "wallet_restored" })
    );
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cancellationId: 600, outcome: "wallet_restored" })
    );
  });

  it("does not fail a successful cancellation when the cancellation email fails", async () => {
    sendPlayerBookingCancelledEmailMock.mockRejectedValue(new Error("resend down"));

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result).toMatchObject({
      success: true,
      released: true,
      message: "Booking Cancelled\n\n£8.00 has been added to your Fair Play Wallet.\n\nYou can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.",
    });
  });
});
