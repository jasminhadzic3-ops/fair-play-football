import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendWaitingListSpotAvailableEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/waitingListSpotAvailable", () => ({
  sendWaitingListSpotAvailableEmail: sendWaitingListSpotAvailableEmailMock,
}));

import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

type WaitingListRow = {
  id: number;
  game_id: number;
  user_id: string;
  player_name: string;
  status: string;
};

const state: {
  waitingRows: WaitingListRow[];
  insertedNotifications: Array<Record<string, unknown>>;
} = {
  waitingRows: [],
  insertedNotifications: [],
};

class MockSupabaseQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  private insertPayload: Record<string, unknown> | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.insertPayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  order() {
    return this;
  }

  async single<T>() {
    if (this.table !== "waiting_list_notifications" || !this.insertPayload) {
      throw new Error(`Unexpected single() call for ${this.table}`);
    }

    state.insertedNotifications.push(this.insertPayload);

    return {
      data: { id: 900 + state.insertedNotifications.length } as T,
      error: null,
    };
  }

  then<TResult1 = { data: WaitingListRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: WaitingListRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    const data = state.waitingRows.filter((row) =>
      this.filters.every((filter) => (row as Record<string, unknown>)[filter.field] === filter.value)
    );

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  sendWaitingListSpotAvailableEmailMock.mockResolvedValue({ id: "email-1" });
  state.waitingRows = [
    {
      id: 800,
      game_id: 10,
      user_id: "user-1",
      player_name: "Waiting Player",
      status: "waiting",
    },
  ];
  state.insertedNotifications = [];
});

describe("notifyWaitingListForOpenSpace", () => {
  it("creates a notification and sends the waiting-list spot email to the same user", async () => {
    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 1 });
    expect(state.insertedNotifications).toHaveLength(1);
    expect(state.insertedNotifications[0]).toMatchObject({
      waiting_list_id: 800,
      game_id: 10,
      user_id: "user-1",
      player_name: "Waiting Player",
      status: "unread",
    });
    expect(sendWaitingListSpotAvailableEmailMock).toHaveBeenCalledWith({
      notificationId: 901,
      waitingListId: 800,
      userId: "user-1",
      gameId: 10,
      playerName: "Waiting Player",
    });
  });

  it("does not break notification flow when the waiting-list email fails", async () => {
    sendWaitingListSpotAvailableEmailMock.mockRejectedValue(new Error("email failed"));

    const result = await notifyWaitingListForOpenSpace(10);

    expect(result).toEqual({ notifiedCount: 1 });
    expect(state.insertedNotifications).toHaveLength(1);
    expect(sendWaitingListSpotAvailableEmailMock).toHaveBeenCalledTimes(1);
  });
});
