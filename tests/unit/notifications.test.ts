import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import {
  createBookingConfirmedNotification,
  createRefundProcessedNotification,
  createWalletCreditNotification,
} from "@/lib/notifications";

const insertedRows: Array<Record<string, unknown>> = [];

class MockInsertQuery {
  private row: Record<string, unknown> | null = null;

  insert(row: Record<string, unknown>) {
    this.row = row;
    return this;
  }

  select() {
    return this;
  }

  async single<T>() {
    if (!this.row) {
      throw new Error("Expected notification insert row.");
    }

    insertedRows.push(this.row);

    return {
      data: { id: insertedRows.length } as T,
      error: null,
    };
  }
}

beforeEach(() => {
  insertedRows.length = 0;
  supabaseFromMock.mockImplementation((table: string) => {
    expect(table).toBe("notifications");
    return new MockInsertQuery();
  });
});

describe("notification helpers", () => {
  it("creates booking notifications with stable destination and dedupe key", async () => {
    await createBookingConfirmedNotification({
      userId: "user-1",
      bookingId: 55,
      game: {
        id: 12,
        title: "Thursday Football",
        time: "21:10",
        location: "Whittington Park",
      },
    });

    expect(insertedRows[0]).toMatchObject({
      user_id: "user-1",
      type: "booking_confirmed",
      category: "bookings",
      title: "You're Booked In",
      icon: "✅",
      action_url: "/my-bookings",
      booking_id: 55,
      game_id: 12,
      dedupe_key: "notification:booking_confirmed:booking:55",
    });
  });

  it("creates refund notifications under the Refunds category", async () => {
    await createRefundProcessedNotification({
      userId: "user-2",
      refundRequestId: 88,
      amount: 5,
    });

    expect(insertedRows[0]).toMatchObject({
      user_id: "user-2",
      type: "refund_processed",
      category: "refunds",
      title: "Refund processed",
      icon: "💷",
      action_url: "/wallet",
      refund_request_id: 88,
      dedupe_key: "notification:refund_processed:refund_request:88",
    });
    expect(insertedRows[0].body).toBe("£5 was returned to your original payment method.");
  });

  it("uses player-friendly wallet credit reasons", async () => {
    await createWalletCreditNotification({
      userId: "user-3",
      walletTransactionId: 101,
      amount: 7,
      reason: "Refund credited to your wallet",
    });

    expect(insertedRows[0]).toMatchObject({
      user_id: "user-3",
      type: "wallet_credit_added",
      category: "wallet",
      title: "£7 added to your wallet",
      body: "Refund credited to your wallet",
      metadata: {
        reason: "Refund credited to your wallet",
      },
    });
  });
});
