import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

import { sendNewGamePostedEmails } from "@/lib/email/newGamePosted";

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
  game: GameRow;
  profiles: ProfileRow[];
  profileEmailLookup: string | null;
} = {
  game: {
    id: 10,
    title: "Friday Football",
    location: "Test Pitch",
    time: "Friday 7pm",
    price: 8,
  },
  profiles: [],
  profileEmailLookup: null,
};

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown; caseInsensitive?: boolean }> = [];

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  ilike(field: string, value: string) {
    state.profileEmailLookup = value;
    this.filters.push({ field, value, caseInsensitive: true });
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle<T>() {
    const [firstRow] = this.filteredRows();
    return { data: (firstRow ?? null) as T | null, error: null };
  }

  then<TResult1 = { data: TableRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.filteredRows(), error: null }).then(onfulfilled, onrejected);
  }

  private filteredRows() {
    const rows: TableRow[] = this.table === "games" ? [state.game] : state.profiles;
    return rows.filter((row) =>
      this.filters.every((filter) => {
        const rawValue = (row as Record<string, unknown>)[filter.field];

        if (filter.caseInsensitive) {
          return String(rawValue ?? "").toLowerCase() === String(filter.value).toLowerCase();
        }

        return rawValue === filter.value;
      })
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_ENABLE_NEW_GAME = "true";
  process.env.EMAIL_BROADCAST_TEST_RECIPIENT = "jasminhadzic3@gmail.com";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  state.profiles = [];
  state.profileEmailLookup = null;
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
});

describe("sendNewGamePostedEmails test-recipient personalization", () => {
  it("uses the matching test-recipient profile username when present", async () => {
    state.profiles = [
      {
        id: "user-1",
        email: "jasminhadzic3@gmail.com",
        username: "Jasmin Hadzic",
      },
    ];

    const result = await sendNewGamePostedEmails({ gameId: 10 });

    expect(result).toEqual({ skipped: false, sentCount: 1 });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jasminhadzic3@gmail.com",
        subject: "Game Available: Friday Football",
        idempotencyKey: "new_game_posted:game:10:recipient:jasminhadzic3@gmail.com",
        text: expect.stringContaining("Hi Jasmin,"),
        html: expect.stringContaining("Hi Jasmin,"),
      })
    );
    const email = sendResendEmailMock.mock.calls[0][0] as {
      html: string;
      text: string;
    };

    expect(email.text).toContain("A new game is available: Friday Football.");
    expect(email.text).toContain("Open the game to book your place.");
    expect(email.text).toContain("Places are first paid, first confirmed.");
    expect(email.text).toContain("View game details: http://localhost:3000/?open_game_id=10#games");
    expect(email.html).toContain("Game Available");
    expect(email.html).toContain("View game details");
    expect(email.html).toContain("first paid, first confirmed");
  });

  it("falls back to Player when no matching test-recipient profile exists", async () => {
    state.profiles = [
      {
        id: "user-1",
        email: "someone@example.com",
        username: "Someone Else",
      },
    ];

    await sendNewGamePostedEmails({ gameId: 10 });

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jasminhadzic3@gmail.com",
        text: expect.stringContaining("Hi Player,"),
        html: expect.stringContaining("Hi Player,"),
      })
    );
  });

  it("falls back to Player when the matching test-recipient profile has no username", async () => {
    state.profiles = [
      {
        id: "user-1",
        email: "jasminhadzic3@gmail.com",
        username: null,
      },
    ];

    await sendNewGamePostedEmails({ gameId: 10 });

    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Hi Player,"),
        html: expect.stringContaining("Hi Player,"),
      })
    );
  });

  it("matches the test-recipient profile email case-insensitively after trimming the configured recipient", async () => {
    process.env.EMAIL_BROADCAST_TEST_RECIPIENT = "  JasminHadzic3@GMAIL.com  ";
    state.profiles = [
      {
        id: "user-1",
        email: "jasminhadzic3@gmail.com",
        username: "Jasmin Hadzic",
      },
    ];

    await sendNewGamePostedEmails({ gameId: 10 });

    expect(state.profileEmailLookup).toBe("jasminhadzic3@gmail.com");
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "JasminHadzic3@GMAIL.com",
        idempotencyKey: "new_game_posted:game:10:recipient:jasminhadzic3@gmail.com",
        text: expect.stringContaining("Hi Jasmin,"),
      })
    );
  });
});
