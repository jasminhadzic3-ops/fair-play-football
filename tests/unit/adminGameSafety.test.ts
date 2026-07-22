import { describe, expect, it } from "vitest";
import {
  buildAdminGameSafetySummary,
  getAdminGameLifecycle,
  isValidAdminMoveDestination,
} from "@/lib/adminGameSafety";

const now = new Date("2026-07-22T12:00:00.000Z");

describe("admin game safety helpers", () => {
  it("classifies active future games as active upcoming", () => {
    expect(
      getAdminGameLifecycle(
        {
          status: "active",
          starts_at: "2026-07-23T18:00:00.000Z",
        },
        now
      )
    ).toBe("active_upcoming");
  });

  it("classifies cancelled games as cancelled", () => {
    expect(
      getAdminGameLifecycle(
        {
          status: "cancelled",
          starts_at: "2026-07-23T18:00:00.000Z",
        },
        now
      )
    ).toBe("cancelled");
  });

  it("classifies archived games separately from lifecycle status", () => {
    expect(
      getAdminGameLifecycle(
        {
          status: "cancelled",
          starts_at: "2026-07-23T18:00:00.000Z",
          archived_at: "2026-07-24T10:00:00.000Z",
        },
        now
      )
    ).toBe("archived");
  });

  it("does not archive cancelled or past legacy games unless archived_at is set", () => {
    expect(
      getAdminGameLifecycle(
        {
          status: "cancelled",
          starts_at: "2026-07-23T18:00:00.000Z",
          archived_at: null,
        },
        now
      )
    ).toBe("cancelled");
    expect(
      getAdminGameLifecycle(
        {
          status: "active",
          starts_at: "2026-07-21T18:00:00.000Z",
          archived_at: null,
        },
        now
      )
    ).toBe("past_legacy");
  });

  it("restores games to their lifecycle classification when archived_at is cleared", () => {
    expect(
      getAdminGameLifecycle(
        {
          status: "cancelled",
          starts_at: "2026-07-23T18:00:00.000Z",
          archived_at: null,
        },
        now
      )
    ).toBe("cancelled");
    expect(
      getAdminGameLifecycle(
        {
          status: "active",
          starts_at: "2026-07-23T18:00:00.000Z",
          archived_at: null,
        },
        now
      )
    ).toBe("active_upcoming");
  });

  it("classifies past and legacy active games as past legacy", () => {
    expect(getAdminGameLifecycle({ status: "active", starts_at: "2026-07-21T18:00:00.000Z" }, now)).toBe(
      "past_legacy"
    );
    expect(getAdminGameLifecycle({ status: "active", starts_at: null }, now)).toBe("past_legacy");
  });

  it("allows only active future games with space as move destinations", () => {
    expect(
      isValidAdminMoveDestination(
        { id: 2, status: "active", starts_at: "2026-07-23T18:00:00.000Z", max_players: 12 },
        1,
        11,
        now
      )
    ).toBe(true);
    expect(
      isValidAdminMoveDestination(
        { id: 1, status: "active", starts_at: "2026-07-23T18:00:00.000Z", max_players: 12 },
        1,
        0,
        now
      )
    ).toBe(false);
    expect(
      isValidAdminMoveDestination(
        { id: 2, status: "active", starts_at: "2026-07-23T18:00:00.000Z", max_players: 12 },
        1,
        12,
        now
      )
    ).toBe(false);
    expect(
      isValidAdminMoveDestination(
        {
          id: 2,
          status: "active",
          starts_at: "2026-07-23T18:00:00.000Z",
          archived_at: "2026-07-22T18:00:00.000Z",
          max_players: 12,
        },
        1,
        0,
        now
      )
    ).toBe(false);
  });

  it("builds delete safety summaries from operational counts", () => {
    const summary = buildAdminGameSafetySummary(
      {
        bookings_count: 2,
        payment_records_count: 1,
        paid_sumup_payments_count: 1,
        wallet_transactions_count: 2,
        wallet_bookings_count: 1,
        waiting_list_count: 1,
        cancellation_credits_count: 1,
        pending_refund_requests_count: 1,
        completed_refunds_count: 0,
        unresolved_refund_attempts_count: 1,
        refund_attempts_count: 1,
        reminder_deliveries_count: 1,
        waiting_list_notifications_count: 1,
      },
      12
    );

    expect(summary).toEqual(
      expect.objectContaining({
        spaces_remaining: 10,
        has_financial_history: true,
        has_refunds: true,
        safe_to_delete: false,
      })
    );
    expect(summary.delete_block_reasons).toEqual(
      expect.arrayContaining([
        "2 bookings",
        "1 paid payment",
        "1 wallet booking",
        "1 waiting-list entry",
        "1 cancellation credit",
        "1 pending refund",
        "1 unresolved refund attempt",
        "1 reminder delivery",
        "1 waiting-list notification",
      ])
    );
  });
});
