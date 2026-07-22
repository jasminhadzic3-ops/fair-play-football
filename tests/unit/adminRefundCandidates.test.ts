import { describe, expect, it } from "vitest";
import { buildAdminRefundCandidates } from "@/lib/adminRefundCandidates";

function baseRows(overrides: {
  game?: Record<string, unknown>;
  booking?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  sourceCredit?: Record<string, unknown>;
  walletTransactions?: Array<Record<string, unknown>>;
  attempts?: Array<Record<string, unknown>>;
} = {}) {
  const game = {
    id: 10,
    status: "cancelled",
    ...overrides.game,
  };
  const booking = {
    id: 100,
    game_id: 10,
    user_id: "user-1",
    player_name: "Refund Player",
    ...overrides.booking,
  };
  const payment = {
    id: 200,
    user_id: "user-1",
    game_id: 10,
    booking_id: 100,
    payment_status: "paid",
    amount: 8,
    currency: "GBP",
    transaction_code: "hidden-code",
    ...overrides.payment,
  };
  const sourceCredit = {
    id: 900,
    user_id: "user-1",
    game_id: 10,
    booking_id: 100,
    payment_id: 200,
    amount: 8,
    currency: "GBP",
    transaction_type: "game_cancelled_credit",
    status: "completed",
    metadata: {
      original_payment_method: "sumup",
      original_game_id: 10,
      original_booking_id: 100,
      original_payment_id: 200,
    },
    ...overrides.sourceCredit,
  };

  return {
    games: [game],
    bookings: [booking],
    profiles: [{ id: "user-1", username: "Refund Player" }],
    bookingPayments: [payment],
    walletTransactions: [sourceCredit, ...(overrides.walletTransactions ?? [])],
    sumUpRefundAttempts: overrides.attempts ?? [],
  } as Parameters<typeof buildAdminRefundCandidates>[0];
}

describe("admin refund candidates", () => {
  it("marks a linked SumUp cancellation credit as eligible", () => {
    const [candidate] = buildAdminRefundCandidates(baseRows());

    expect(candidate).toEqual(
      expect.objectContaining({
        source_wallet_transaction_id: 900,
        refund_status: "eligible",
        refund_eligible: true,
        safe_reason: "Eligible for full SumUp refund.",
      })
    );
  });

  it("does not allow wallet-paid cancellation credits through SumUp", () => {
    const [candidate] = buildAdminRefundCandidates(
      baseRows({
        sourceCredit: {
          payment_id: null,
          metadata: {
            original_payment_method: "wallet",
            original_game_id: 10,
            original_booking_id: 100,
          },
        },
      })
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        refund_status: "not_eligible",
        refund_eligible: false,
        safe_reason: "Only SumUp cancellation credits can be refunded to card.",
      })
    );
  });

  it("blocks inconsistent player/payment/game linkage", () => {
    const [candidate] = buildAdminRefundCandidates(
      baseRows({
        payment: {
          user_id: "different-user",
        },
      })
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        refund_status: "not_eligible",
        refund_eligible: false,
        safe_reason: "Linked player, game, booking and payment details do not match.",
      })
    );
  });

  it("blocks ambiguous payment history", () => {
    const rows = baseRows();

    const [candidate] = buildAdminRefundCandidates({
      ...rows,
      bookingPayments: [
        ...rows.bookingPayments,
        {
          id: 201,
          user_id: "user-1",
          game_id: 10,
          booking_id: 100,
          payment_status: "pending",
          amount: 8,
          currency: "GBP",
        },
      ],
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        refund_status: "not_eligible",
        refund_eligible: false,
        safe_reason: "This booking has ambiguous payment history and cannot be refunded automatically.",
      })
    );
  });

  it("blocks existing unknown refund attempts", () => {
    const [candidate] = buildAdminRefundCandidates(
      baseRows({
        walletTransactions: [
          {
            id: 501,
            user_id: "user-1",
            game_id: 10,
            booking_id: 100,
            payment_id: 200,
            amount: -8,
            currency: "GBP",
            transaction_type: "refund_requested",
            status: "processing",
            metadata: {
              source_wallet_transaction_id: 900,
            },
          },
        ],
        attempts: [
          {
            id: 700,
            refund_request_id: 501,
            status: "unknown",
            created_at: "2026-07-01T10:00:00.000Z",
            updated_at: "2026-07-01T10:00:00.000Z",
          },
        ],
      })
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        refund_status: "needs_review",
        refund_eligible: false,
        refund_request_id: 501,
        sumup_refund_attempt_id: 700,
        sumup_refund_attempt_status: "unknown",
      })
    );
  });
});
