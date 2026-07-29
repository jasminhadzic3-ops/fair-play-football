import { beforeEach, describe, expect, it, vi } from "vitest";

const runPostBookingActionsMock = vi.hoisted(() => vi.fn());
const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const bookGameWithWalletMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/postBookingActions", () => ({
  runPostBookingActions: runPostBookingActionsMock,
}));

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/wallet", () => ({
  bookGameWithWallet: bookGameWithWalletMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { POST } from "@/app/api/wallet/bookings/route";

type GameRow = {
  id: number;
  title: string | null;
  price: number | null;
  status: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

type BookingRow = {
  id: number;
  game_id: number;
  user_id: string;
};

type TableRow = GameRow | ProfileRow | BookingRow;

const state: {
  game: GameRow | null;
  profile: ProfileRow | null;
  bookings: BookingRow[];
} = {
  game: null,
  profile: null,
  bookings: [],
};

function getRowField(row: TableRow, field: string) {
  return (row as Record<string, unknown>)[field];
}

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown }> = [];

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  async maybeSingle<T>() {
    const rows =
      this.table === "games"
        ? [state.game].filter(Boolean)
        : this.table === "profiles"
          ? [state.profile].filter(Boolean)
          : state.bookings;
    const matchedRow = rows.find((row) =>
      this.filters.every((filter) => getRowField(row as TableRow, filter.field) === filter.value)
    );

    return { data: (matchedRow ?? null) as T | null, error: null };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email: "auth@example.com",
    email_confirmed_at: "2026-07-01T10:00:00.000Z",
  });
  bookGameWithWalletMock.mockResolvedValue({
    success: true,
    bookingId: 123,
    walletTransactionId: 456,
    reason: null,
    balance: 12,
  });
  runPostBookingActionsMock.mockResolvedValue(undefined);
  state.game = {
    id: 10,
    title: "Friday Football",
    price: 8,
    status: "active",
  };
  state.profile = {
    id: "user-1",
    email: "profile@example.com",
    username: "Profile Player",
  };
  state.bookings = [];
});

describe("wallet booking route", () => {
  it("passes wallet booking confirmation details into post-booking actions", async () => {
    const request = new Request("http://localhost/api/wallet/bookings", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        gameId: 10,
        playerName: "Wallet Player",
      }),
    });

    const response = await POST(request as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      booking_id: 123,
      wallet_transaction_id: 456,
      payment_status: "paid",
      payment_method: "wallet",
    });
    expect(runPostBookingActionsMock).toHaveBeenCalledTimes(1);
    expect(runPostBookingActionsMock).toHaveBeenCalledWith({
      bookingId: 123,
      userId: "user-1",
      gameId: 10,
      playerName: "Wallet Player",
      bookingConfirmation: {
        paymentId: 456,
        amount: 8,
        currency: "GBP",
        checkoutId: null,
        checkoutReference: null,
      },
    });
  });

  it("uses a fresh wallet booking idempotency key for each booking cycle", async () => {
    const requestBody = {
      gameId: 10,
      playerName: "Wallet Player",
    };
    const firstResponse = await POST(
      new Request("http://localhost/api/wallet/bookings", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }) as Parameters<typeof POST>[0]
    );
    const secondResponse = await POST(
      new Request("http://localhost/api/wallet/bookings", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }) as Parameters<typeof POST>[0]
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(bookGameWithWalletMock).toHaveBeenCalledTimes(2);
    const firstKey = bookGameWithWalletMock.mock.calls[0][0].idempotencyKey;
    const secondKey = bookGameWithWalletMock.mock.calls[1][0].idempotencyKey;

    expect(firstKey).toMatch(/^wallet_booking_payment:game:10:user:user-1:player:wallet player:request:/);
    expect(secondKey).toMatch(/^wallet_booking_payment:game:10:user:user-1:player:wallet player:request:/);
    expect(secondKey).not.toBe(firstKey);
  });

  it("blocks wallet booking when the user already has an active booking under any player name", async () => {
    state.bookings = [
      {
        id: 321,
        game_id: 10,
        user_id: "user-1",
      },
    ];

    const response = await POST(
      new Request("http://localhost/api/wallet/bookings", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId: 10,
          playerName: "New Display Name",
        }),
      }) as Parameters<typeof POST>[0]
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("You have already joined this game.");
    expect(bookGameWithWalletMock).not.toHaveBeenCalled();
  });
});
