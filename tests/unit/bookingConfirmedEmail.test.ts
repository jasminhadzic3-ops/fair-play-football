import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
    auth: {
      admin: {
        getUserById: getUserByIdMock,
      },
    },
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

import { sendBookingConfirmedEmail } from "@/lib/email/bookingConfirmed";

type GameRow = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  price: number | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

type TableRow = GameRow | ProfileRow;

const state: {
  game: GameRow | null;
  profile: ProfileRow | null;
} = {
  game: null,
  profile: null,
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
    const rows = this.table === "games" ? [state.game].filter(Boolean) : [state.profile].filter(Boolean);
    const matchedRow = rows.find((row) =>
      this.filters.every((filter) => getRowField(row as TableRow, filter.field) === filter.value)
    );

    return { data: (matchedRow ?? null) as T | null, error: null };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  getUserByIdMock.mockResolvedValue({
    data: {
      user: {
        email: "auth@example.com",
      },
    },
    error: null,
  });
  state.game = {
    id: 10,
    title: "Friday Football",
    location: "Test Pitch",
    time: "Friday 7pm",
    price: 8,
  };
  state.profile = {
    id: "user-1",
    email: "profile@example.com",
    username: "Profile Player",
  };
});

describe("sendBookingConfirmedEmail", () => {
  it("uses profiles.email first and sends with the booking idempotency key", async () => {
    await sendBookingConfirmedEmail({
      bookingId: 123,
      paymentId: 456,
      userId: "user-1",
      gameId: 10,
      playerName: "Fallback Player",
      amount: 8,
      currency: "GBP",
      checkoutId: "checkout-1",
      checkoutReference: "reference-1",
    });

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "profile@example.com",
        subject: "Booking confirmed: Friday Football",
        idempotencyKey: "booking_confirmed:booking:123",
      })
    );
  });

  it("falls back to Supabase Auth email when profile email is missing", async () => {
    state.profile = {
      id: "user-1",
      email: null,
      username: "Profile Player",
    };

    await sendBookingConfirmedEmail({
      bookingId: 124,
      paymentId: 457,
      userId: "user-1",
      gameId: 10,
      playerName: "Fallback Player",
      amount: 8,
      currency: "GBP",
    });

    expect(getUserByIdMock).toHaveBeenCalledWith("user-1");
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "auth@example.com",
        idempotencyKey: "booking_confirmed:booking:124",
      })
    );
  });
});
