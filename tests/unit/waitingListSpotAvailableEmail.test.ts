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

import { sendWaitingListSpotAvailableEmail } from "@/lib/email/waitingListSpotAvailable";

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

describe("sendWaitingListSpotAvailableEmail", () => {
  it("sends to the profile email with the waiting-list idempotency key", async () => {
    await sendWaitingListSpotAvailableEmail({
      notificationId: 700,
      waitingListId: 800,
      userId: "user-1",
      gameId: 10,
      playerName: "Fallback Player",
    });

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "profile@example.com",
        subject: "Waiting List: Friday Football",
        idempotencyKey: "waiting_list_spot_available:notification:700",
      })
    );
  });

  it("falls back to Supabase Auth email when profile email is missing", async () => {
    state.profile = {
      id: "user-1",
      email: null,
      username: "Profile Player",
    };

    await sendWaitingListSpotAvailableEmail({
      notificationId: 701,
      waitingListId: 801,
      userId: "user-1",
      gameId: 10,
      playerName: "Fallback Player",
    });

    expect(getUserByIdMock).toHaveBeenCalledWith("user-1");
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "auth@example.com",
        idempotencyKey: "waiting_list_spot_available:notification:701",
      })
    );
  });
});
