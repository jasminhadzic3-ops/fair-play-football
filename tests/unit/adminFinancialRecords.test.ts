import { describe, expect, it } from "vitest";
import { buildAdminFinancialRecordsByGame } from "@/lib/adminFinancialRecords";

describe("admin financial records", () => {
  it("builds sanitized per-game financial rows without raw payment identifiers", () => {
    const recordsByGame = buildAdminFinancialRecordsByGame({
      games: [{ id: 10 }],
      bookings: [{ id: 100, game_id: 10, user_id: "user-1", player_name: "Player One" }],
      bookingPayments: [
        {
          id: 200,
          user_id: "user-1",
          game_id: 10,
          booking_id: 100,
          player_name: "Player One",
          payment_status: "paid",
          amount: 8,
          currency: "GBP",
          created_at: "2026-07-01T10:00:00.000Z",
          // These extra fields simulate raw table data and must never be copied into output rows.
          transaction_code: "TXN-SECRET",
          sumup_transaction_id: "SUMUP-ID",
          raw_checkout: { hosted_checkout_url: "https://example.invalid/secret" },
        } as never,
      ],
      walletTransactions: [
        {
          id: 300,
          user_id: "user-1",
          game_id: 10,
          booking_id: 100,
          payment_id: 200,
          transaction_type: "game_cancelled_credit",
          status: "completed",
          amount: 8,
          currency: "GBP",
          created_at: "2026-07-02T10:00:00.000Z",
          metadata: { original_game_id: 10, token: "secret" },
        },
        {
          id: 301,
          user_id: "user-1",
          game_id: 10,
          booking_id: 100,
          payment_id: 200,
          transaction_type: "refund_requested",
          status: "pending",
          amount: -8,
          currency: "GBP",
          created_at: "2026-07-03T10:00:00.000Z",
          metadata: { original_game_id: 10 },
        },
      ],
      sumUpRefundAttempts: [
        {
          id: 400,
          refund_request_id: 301,
          booking_payment_id: 200,
          status: "unknown",
          created_at: "2026-07-04T10:00:00.000Z",
        },
      ],
      waitingList: [{ id: 500, game_id: 10, player_name: "Waiting Player", status: "waiting" }],
      waitingListNotifications: [],
      reminderDeliveries: [{ id: 600, game_id: 10, booking_id: 100, status: "sent", attempts: 1 }],
    });

    const records = recordsByGame.get(10) ?? [];

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_type: "paid_sumup_payment", player_name: "Player One" }),
        expect.objectContaining({ record_type: "cancellation_credit", player_name: "Player One" }),
        expect.objectContaining({ record_type: "refund_request", player_name: "Player One" }),
        expect.objectContaining({ record_type: "sumup_refund_attempt", player_name: "Player One" }),
        expect.objectContaining({ record_type: "waiting_list", player_name: "Waiting Player" }),
        expect.objectContaining({ record_type: "reminder_delivery", player_name: "Player One" }),
      ])
    );
    expect(JSON.stringify(records)).not.toContain("TXN-SECRET");
    expect(JSON.stringify(records)).not.toContain("SUMUP-ID");
    expect(JSON.stringify(records)).not.toContain("hosted_checkout_url");
    expect(JSON.stringify(records)).not.toContain("token");
  });
});
