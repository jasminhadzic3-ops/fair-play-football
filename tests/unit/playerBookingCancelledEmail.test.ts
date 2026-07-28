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

import {
  sendPlayerBookingCancelledEmail,
  type PlayerBookingCancellationEmailOutcome,
} from "@/lib/email/playerBookingCancelled";

type GameRow = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

type TableRow = GameRow | ProfileRow;

const state: {
  game: GameRow;
  profile: ProfileRow;
} = {
  game: {
    id: 10,
    title: "Thursday Football",
    location: "Whittington Park",
    time: "30 Jul 2026, 19:00",
    starts_at: "2026-07-30T18:00:00.000Z",
  },
  profile: {
    id: "user-1",
    email: "profile@example.com",
    username: "Jasmin Hadzic",
  },
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
    const rows = this.table === "games" ? [state.game] : [state.profile];
    const row = rows.find((candidate) =>
      this.filters.every((filter) => getRowField(candidate, filter.field) === filter.value)
    );

    return { data: (row ?? null) as T | null, error: null };
  }
}

async function sendForOutcome(outcome: PlayerBookingCancellationEmailOutcome, amount: number | null = 8) {
  await sendPlayerBookingCancelledEmail({
    cancellationId: 600,
    bookingId: 100,
    gameId: 10,
    userId: "user-1",
    outcome,
    amount,
    currency: "GBP",
  });

  return sendResendEmailMock.mock.calls.at(-1)?.[0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.fairplayfootball.co.uk";
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  getUserByIdMock.mockResolvedValue({
    data: { user: { email: "auth@example.com" } },
    error: null,
  });
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  state.game = {
    id: 10,
    title: "Thursday Football",
    location: "Whittington Park",
    time: "30 Jul 2026, 19:00",
    starts_at: "2026-07-30T18:00:00.000Z",
  };
  state.profile = {
    id: "user-1",
    email: "profile@example.com",
    username: "Jasmin Hadzic",
  };
});

describe("sendPlayerBookingCancelledEmail", () => {
  it.each([
    [
      "wallet_restored",
      "Booking cancelled: Thursday Football - wallet credit restored",
      "Your booking has been cancelled and £8.00 has been restored to your Fair Play wallet.",
    ],
    [
      "card_refund_completed",
      "Booking cancelled: Thursday Football - card refund processed",
      "Your booking has been cancelled and your £8.00 card refund has been processed.",
    ],
    [
      "card_refund_pending",
      "Booking cancelled: Thursday Football - card refund processing",
      "Your booking has been cancelled. Your £8.00 card refund is being processed and may take a few working days to appear.",
    ],
    [
      "card_refund_manual_review",
      "Booking cancelled: Thursday Football - refund needs review",
      "Your booking has been cancelled. Your £8.00 card refund is reserved and needs a review before it can be completed.",
    ],
    [
      "card_refund_failed",
      "Booking cancelled: Thursday Football - refund follow-up needed",
      "Your booking has been cancelled, but we could not complete your £8.00 card refund automatically. The refund remains recorded for follow-up.",
    ],
    [
      "no_refund_within_24h",
      "Booking cancelled: Thursday Football - booking cancelled",
      "Your booking has been cancelled. As the cancellation was made within 24 hours of kick-off, no refund is available.",
    ],
  ] satisfies Array<[PlayerBookingCancellationEmailOutcome, string, string]>)(
    "renders the %s outcome",
    async (outcome, subject, explanation) => {
      const email = await sendForOutcome(outcome);

      expect(email.to).toBe("profile@example.com");
      expect(email.subject).toBe(subject);
      expect(email.text).toContain("Hi Jasmin,");
      expect(email.text).toContain(explanation);
      expect(email.html).toContain(explanation);
      expect(email.text).toContain("Date: Thursday, 30 July 2026");
      expect(email.text).toContain("Kick-off: 19:00");
      expect(email.text).toContain("Location: Whittington Park");
      expect(email.text).toContain("Browse upcoming games: https://www.fairplayfootball.co.uk/#games");
      expect(email.html).toContain("Browse Upcoming Games");
      expect(email.idempotencyKey).toBe(`player_booking_cancelled:cancellation:600:outcome:${outcome}`);
    }
  );

  it("falls back to Player and Supabase Auth email when profile details are missing", async () => {
    state.profile = {
      id: "user-1",
      email: null,
      username: null,
    };

    const email = await sendForOutcome("no_refund_within_24h", null);

    expect(email.to).toBe("auth@example.com");
    expect(email.text).toContain("Hi Player,");
    expect(email.text).not.toContain("Refund amount:");
  });

  it("uses legacy display time when structured kickoff is unavailable", async () => {
    state.game.starts_at = null;
    state.game.time = "Friday 7pm";

    const email = await sendForOutcome("wallet_restored");

    expect(email.text).toContain("Date: Friday 7pm");
    expect(email.text).toContain("Kick-off: Friday 7pm");
  });
});
