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

import { sendGameCancelledEmails } from "@/lib/email/gameCancelled";

type GameRow = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  price: number | null;
};

type BookingRow = {
  game_id: number;
  user_id: string | null;
  player_name: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

type Filter =
  | { type: "eq"; field: string; value: unknown }
  | { type: "in"; field: string; values: unknown[] };

type TableRow = GameRow | BookingRow | ProfileRow;

const state: {
  game: GameRow | null;
  bookings: BookingRow[];
  profiles: ProfileRow[];
} = {
  game: null,
  bookings: [],
  profiles: [],
};

function getRowField(row: TableRow, field: string) {
  return (row as Record<string, unknown>)[field];
}

function tableRows(table: string): TableRow[] {
  switch (table) {
    case "games":
      return state.game ? [state.game] : [];
    case "bookings":
      return state.bookings;
    case "profiles":
      return state.profiles;
    default:
      throw new Error(`Unexpected Supabase table: ${table}`);
  }
}

function applyFilters(rows: TableRow[], filters: Filter[]) {
  return filters.reduce((filteredRows, filter) => {
    if (filter.type === "eq") {
      return filteredRows.filter((row) => getRowField(row, filter.field) === filter.value);
    }

    return filteredRows.filter((row) => filter.values.includes(getRowField(row, filter.field)));
  }, rows);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];

  constructor(private table: string) {}

  select() {
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ type: "eq", field, value });
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push({ type: "in", field, values });
    return this;
  }

  async maybeSingle<T>() {
    const [firstRow] = applyFilters(tableRows(this.table), this.filters);
    return { data: (firstRow ?? null) as T | null, error: null };
  }

  then<TResult1 = { data: TableRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({
      data: applyFilters(tableRows(this.table), this.filters),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_ENABLE_GAME_CANCELLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  getUserByIdMock.mockImplementation(async (userId: string) => ({
    data: {
      user: {
        email: userId === "user-with-auth-email" ? "auth@example.com" : null,
      },
    },
    error: null,
  }));
  state.game = {
    id: 10,
    title: "Friday Football",
    location: "Test Pitch",
    time: "Friday 7pm",
    price: 8,
  };
  state.bookings = [];
  state.profiles = [];
});

describe("sendGameCancelledEmails", () => {
  it("uses profiles.email first and falls back to Supabase Auth email when profile email is missing", async () => {
    state.bookings = [
      { game_id: 10, user_id: "user-with-profile-email", player_name: "Profile Player" },
      { game_id: 10, user_id: "user-with-auth-email", player_name: "Auth Player" },
    ];
    state.profiles = [
      {
        id: "user-with-profile-email",
        email: "profile@example.com",
        username: "Profile Name",
      },
      {
        id: "user-with-auth-email",
        email: null,
        username: "Auth Name",
      },
    ];

    const result = await sendGameCancelledEmails({ gameId: 10 });

    expect(result).toEqual({ skipped: false, sentCount: 2 });
    expect(getUserByIdMock).toHaveBeenCalledTimes(1);
    expect(getUserByIdMock).toHaveBeenCalledWith("user-with-auth-email");
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendResendEmailMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "profile@example.com",
        subject: "Game cancelled: Friday Football",
        idempotencyKey: "game_cancelled:game:10:recipient:user-with-profile-email",
      })
    );
    expect(sendResendEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: "auth@example.com",
        idempotencyKey: "game_cancelled:game:10:recipient:user-with-auth-email",
      })
    );
    const firstEmail = sendResendEmailMock.mock.calls[0][0] as {
      html: string;
      text: string;
    };

    expect(firstEmail.text).toContain("Hi Profile,");
    expect(firstEmail.text).toContain("Unfortunately, Friday Football has been cancelled.");
    expect(firstEmail.text).toContain("£8.00 has been added to your Fair Play Wallet and is ready to use immediately.");
    expect(firstEmail.text).toContain("Location: Test Pitch");
    expect(firstEmail.text).toContain("Kick-off: Friday 7pm");
    expect(firstEmail.text).toContain("Wallet credit: £8.00");
    expect(firstEmail.text).toContain("View wallet: http://localhost:3000/wallet");
    expect(firstEmail.text).toContain("Browse games: http://localhost:3000/#games");
    expect(firstEmail.html).toContain("Your credit is ready");
    expect(firstEmail.html).toContain("View wallet");
    expect(`${firstEmail.text}\n${firstEmail.html}`).not.toMatch(/automatic(?:ally)? refund/i);
    expect(`${firstEmail.text}\n${firstEmail.html}`).not.toMatch(/reply to this email/i);
  });
});
