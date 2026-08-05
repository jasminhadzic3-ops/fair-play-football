import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());
const sendEmailWithDeliveryTrackingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

vi.mock("@/lib/email/deliveryTracking", () => ({
  sendEmailWithDeliveryTracking: sendEmailWithDeliveryTrackingMock,
}));

import { sendGameHalfFullEmails } from "@/lib/email/gameHalfFull";

type GameRow = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  price: number | null;
  max_players: number | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

const state: {
  game: GameRow | null;
  bookingCount: number;
  profiles: ProfileRow[];
} = {
  game: null,
  bookingCount: 0,
  profiles: [],
};

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  private countOptions?: { count?: string; head?: boolean };

  constructor(private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.countOptions = options;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  not() {
    return this;
  }

  async maybeSingle<T>() {
    return {
      data: state.game as T | null,
      error: null,
    };
  }

  then(resolve: (value: unknown) => void) {
    if (this.table === "bookings" && this.countOptions?.head) {
      resolve({ count: state.bookingCount, error: null });
      return;
    }

    if (this.table === "profiles") {
      resolve({ data: state.profiles, error: null });
      return;
    }

    resolve({ data: null, error: null });
  }
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
  process.env.EMAIL_ENABLE_GAME_HALF_FULL = "true";
  delete process.env.EMAIL_BROADCAST_TEST_RECIPIENT;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  setupTrackingWithDurableSkip();
  state.game = {
    id: 10,
    title: "Friday Football",
    location: "Test Pitch",
    time: "Friday 7pm",
    price: 8,
    max_players: 10,
  };
  state.bookingCount = 5;
  state.profiles = [
    { id: "user-1", email: "one@example.com", username: "One Player" },
    { id: "user-2", email: "two@example.com", username: "Two Player" },
  ];
});

describe("sendGameHalfFullEmails", () => {
  it("creates durable deliveries only after the half-full threshold is reached", async () => {
    state.bookingCount = 4;

    const result = await sendGameHalfFullEmails({ gameId: 10 });

    expect(result).toEqual({ skipped: true, sentCount: 0 });
    expect(sendEmailWithDeliveryTrackingMock).not.toHaveBeenCalled();
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("prevents duplicate half-full sends per game and player", async () => {
    const first = await sendGameHalfFullEmails({ gameId: 10 });
    const second = await sendGameHalfFullEmails({ gameId: 10 });

    expect(first).toEqual({ skipped: false, sentCount: 2 });
    expect(second).toEqual({ skipped: false, sentCount: 0 });
    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenCalledTimes(4);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailWithDeliveryTrackingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryKey: "game_half_full:game:10:recipient:user-1",
        emailType: "game_half_full",
        recipientKey: "user-1",
        gameId: 10,
        metadata: {
          half_full_threshold: 5,
        },
      })
    );
  });

  it("keeps the Resend idempotency key as an additional safeguard", async () => {
    await sendGameHalfFullEmails({ gameId: 10 });

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Game Filling Up Fast ⚽",
        idempotencyKey: "game_half_full:game:10:recipient:user-1",
      })
    );
    const email = sendResendEmailMock.mock.calls[0][0] as {
      html: string;
      text: string;
    };

    expect(email.text).toContain("This game is already over halfway full.");
    expect(email.text).toContain("If you're planning to play, now's a good time to secure your spot.");
    expect(email.text).toContain("📅 Friday 7pm");
    expect(email.text).toContain("🕒 Friday 7pm");
    expect(email.text).toContain("📍 Test Pitch");
    expect(email.text).toContain("💷 £8.00");
    expect(email.text).toContain("Book Now: http://localhost:3000/?open_game_id=10#games");
    expect(email.html).toContain("Game Filling Up Fast ⚽");
    expect(email.html).toContain("Book Now");
    expect(email.html).toContain("booking@fairplayfootball.co.uk");
  });

  it("uses a hashed test-recipient delivery key instead of storing the email address in the ledger key", async () => {
    process.env.EMAIL_BROADCAST_TEST_RECIPIENT = "TestRecipient@example.com";

    await sendGameHalfFullEmails({ gameId: 10 });

    const deliveryParams = sendEmailWithDeliveryTrackingMock.mock.calls[0][0] as {
      deliveryKey: string;
      recipientKey: string;
    };

    expect(deliveryParams.deliveryKey).toMatch(/^game_half_full:game:10:recipient:test:[a-f0-9]{64}$/);
    expect(deliveryParams.deliveryKey).not.toContain("TestRecipient@example.com");
    expect(deliveryParams.recipientKey).toMatch(/^test:[a-f0-9]{64}$/);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
  });
});
