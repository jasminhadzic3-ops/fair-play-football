import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRpcMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const getAutomaticRefundDependencyMock = vi.hoisted(() => vi.fn());
const processAutomaticSumUpRefundMock = vi.hoisted(() => vi.fn());
const getLatestSumUpRefundAttemptForRequestMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/sumupRefundDependencies", () => ({
  getAutomaticRefundDependency: getAutomaticRefundDependencyMock,
}));

vi.mock("@/lib/sumupRefundProcessing", () => ({
  processAutomaticSumUpRefund: processAutomaticSumUpRefundMock,
}));

vi.mock("@/lib/wallet", () => ({
  getLatestSumUpRefundAttemptForRequest: getLatestSumUpRefundAttemptForRequestMock,
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
    refund_request_id: 800,
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
  getAutomaticRefundDependencyMock.mockReturnValue(null);
  getLatestSumUpRefundAttemptForRequestMock.mockResolvedValue(null);
  sendPlayerBookingCancelledEmailMock.mockResolvedValue({ id: "email-1" });
  processAutomaticSumUpRefundMock.mockResolvedValue({
    outcome: "completed",
    status: 200,
    message: "SumUp refund completed and wallet balance was updated.",
    attemptId: 900,
    refundRequestId: 800,
    refundTransactionId: 901,
    skippedSumUpRefundCall: false,
    balanceBreakdown: {
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    },
  });
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
      refundRequestId: 800,
      shouldNotifyWaitingList: true,
      automaticRefund: {
        status: "disabled",
        message: "Card refund requested and reserved; awaiting processing.",
      },
    });
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith({
      cancellationId: 600,
      bookingId: 100,
      gameId: 10,
      userId: "user-1",
      outcome: "card_refund_pending",
      amount: 8,
      currency: "GBP",
    });
  });

  it("processes an eligible SumUp refund only after the RPC returns a refund request", async () => {
    const refundDependency = vi.fn();
    getAutomaticRefundDependencyMock.mockReturnValue(refundDependency);

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith({
      refundRequestId: 800,
      actorUserId: "user-1",
      initiatedBy: "player",
      refundDependency,
    });
    expect(result.automaticRefund).toMatchObject({
      status: "completed",
      refund_transaction_id: 901,
      sumup_refund_attempt_id: 900,
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "card_refund_completed",
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
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      message: "Booking cancelled and wallet credit restored.",
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
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
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
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());

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
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
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
        status: "disabled",
      },
    });
    expect(sendPlayerBookingCancelledEmailMock).not.toHaveBeenCalled();
  });

  it("does not immediately retry recent failed SumUp attempts", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    getLatestSumUpRefundAttemptForRequestMock.mockResolvedValue({
      status: "failed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(result.automaticRefund).toEqual({
      status: "cooling_down",
      message: "Card refund could not complete. Please wait before trying again or contact support.",
    });
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "card_refund_failed",
      })
    );
  });

  it("maps unknown SumUp refund outcomes to manual-review cancellation email", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_unknown",
      attemptId: 900,
      refundRequestId: 800,
      diagnosticCode: "sumup_unknown",
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result.automaticRefund.status).toBe("manual_review");
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "card_refund_manual_review",
      })
    );
  });

  it("maps failed SumUp refund outcomes to failed cancellation email", async () => {
    getAutomaticRefundDependencyMock.mockReturnValue(vi.fn());
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_failed",
      attemptId: 900,
      refundRequestId: 800,
      diagnosticCode: "sumup_failed",
    });

    const result = await cancelPlayerBookingWithRefundPolicy({
      bookingId: 100,
      userId: "user-1",
    });

    expect(result.automaticRefund.status).toBe("failed");
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "card_refund_failed",
      })
    );
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
      expect.objectContaining({ cancellationId: 600, outcome: "card_refund_pending" })
    );
    expect(sendPlayerBookingCancelledEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cancellationId: 600, outcome: "card_refund_pending" })
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
      message: "Card refund requested and reserved; awaiting processing.",
    });
  });
});
