import { beforeEach, describe, expect, it, vi } from "vitest";

const sendGameReminderEmailMock = vi.hoisted(() => vi.fn());
const isGameReminderEmailEnabledMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/gameReminder", () => ({
  isGameReminderEmailEnabled: isGameReminderEmailEnabledMock,
  sendGameReminderEmail: sendGameReminderEmailMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  assertSupabaseAdminConfigured: vi.fn(),
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

import { runGameReminderScheduler } from "@/lib/gameReminderScheduler";

type Row = Record<string, any>;
type Filter = { op: "eq" | "neq" | "in" | "is" | "not" | "gte" | "lte"; field: string; value: any };

const now = new Date("2026-07-22T12:00:00.000Z");

const state: {
  games: Row[];
  bookings: Row[];
  profiles: Row[];
  booking_payments: Row[];
  wallet_transactions: Row[];
  game_reminder_deliveries: Row[];
  nextDeliveryId: number;
} = {
  games: [],
  bookings: [],
  profiles: [],
  booking_payments: [],
  wallet_transactions: [],
  game_reminder_deliveries: [],
  nextDeliveryId: 1,
};

function applyFilters(rows: Row[], filters: Filter[]) {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.op === "eq") {
        return row[filter.field] === filter.value;
      }

      if (filter.op === "neq") {
        return row[filter.field] !== filter.value;
      }

      if (filter.op === "in") {
        return filter.value.includes(row[filter.field]);
      }

      if (filter.op === "is") {
        return filter.value === null ? row[filter.field] === null : row[filter.field] === filter.value;
      }

      if (filter.op === "not" && filter.value === null) {
        return row[filter.field] !== null && row[filter.field] !== undefined;
      }

      if (filter.op === "gte") {
        return String(row[filter.field]) >= String(filter.value);
      }

      if (filter.op === "lte") {
        return String(row[filter.field]) <= String(filter.value);
      }

      return true;
    })
  );
}

class MockQuery {
  private filters: Filter[] = [];
  private updatePayload: Row | null = null;
  private limitCount: number | null = null;
  private upsertRows: Row[] | null = null;

  constructor(private table: keyof typeof state) {}

  select() {
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push({ op: "eq", field, value });
    return this;
  }

  neq(field: string, value: any) {
    this.filters.push({ op: "neq", field, value });
    return this;
  }

  in(field: string, value: any[]) {
    this.filters.push({ op: "in", field, value });
    return this;
  }

  is(field: string, value: any) {
    this.filters.push({ op: "is", field, value });
    return this;
  }

  not(field: string, _operator: string, value: any) {
    this.filters.push({ op: "not", field, value });
    return this;
  }

  gte(field: string, value: any) {
    this.filters.push({ op: "gte", field, value });
    return this;
  }

  lte(field: string, value: any) {
    this.filters.push({ op: "lte", field, value });
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  upsert(rows: Row[]) {
    this.upsertRows = rows;
    const inserted: Row[] = [];

    for (const row of rows) {
      const exists = state.game_reminder_deliveries.some(
        (delivery) => delivery.game_id === row.game_id && delivery.user_id === row.user_id
      );

      if (!exists) {
        const insertedRow = {
          id: state.nextDeliveryId++,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          sent_at: null,
          ...row,
        };
        state.game_reminder_deliveries.push(insertedRow);
        inserted.push(insertedRow);
      }
    }

    return new MockStaticResult(inserted);
  }

  update(payload: Row) {
    this.updatePayload = payload;
    return this;
  }

  async maybeSingle<T>() {
    const rows = await this.resolveRows();
    return { data: (rows[0] ?? null) as T | null, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.resolveRows().then((data) => ({ data, error: null })).then(onfulfilled, onrejected);
  }

  private async resolveRows() {
    if (this.upsertRows) {
      return [];
    }

    const tableRows = state[this.table] as Row[];
    const matchingRows = applyFilters(tableRows, this.filters);

    if (this.updatePayload) {
      matchingRows.forEach((row) => {
        Object.assign(row, this.updatePayload, { updated_at: now.toISOString() });
      });
    }

    return this.limitCount ? matchingRows.slice(0, this.limitCount) : matchingRows;
  }
}

class MockStaticResult {
  constructor(private data: Row[]) {}

  select() {
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.data, error: null }).then(onfulfilled, onrejected);
  }
}

function seedBaseRows(overrides: Partial<{ payment: Row | null; wallet: Row; game: Row }> = {}) {
  state.games = [
    {
      id: 10,
      title: "Reminder Game",
      location: "Archway",
      time: "23 Jul 2026, 13:00",
      price: 5,
      starts_at: "2026-07-23T13:00:00.000Z",
      status: "active",
      archived_at: null,
      ...overrides.game,
    },
  ];
  state.bookings = [{ id: 100, game_id: 10, user_id: "user-1", player_name: "Player One" }];
  state.profiles = [{ id: "user-1", email: "player@example.com", username: "Player One" }];
  state.booking_payments = overrides.payment === null ? [] : [
    {
      booking_id: 100,
      payment_status: "paid",
      amount: 5,
      ...overrides.payment,
    },
  ];
  state.wallet_transactions = overrides.wallet ? [overrides.wallet] : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  isGameReminderEmailEnabledMock.mockReturnValue(true);
  sendGameReminderEmailMock.mockResolvedValue({ id: "email-1" });
  supabaseFromMock.mockImplementation((table: keyof typeof state) => new MockQuery(table));
  state.games = [];
  state.bookings = [];
  state.profiles = [];
  state.booking_payments = [];
  state.wallet_transactions = [];
  state.game_reminder_deliveries = [];
  state.nextDeliveryId = 1;
});

describe("game reminder scheduler", () => {
  it("does no work when reminder emails are disabled", async () => {
    isGameReminderEmailEnabledMock.mockReturnValue(false);
    seedBaseRows();

    const result = await runGameReminderScheduler({ now });

    expect(result.disabled).toBe(true);
    expect(sendGameReminderEmailMock).not.toHaveBeenCalled();
    expect(state.game_reminder_deliveries).toHaveLength(0);
  });

  it("creates, claims and sends one reminder for a paid SumUp booking", async () => {
    seedBaseRows();

    const result = await runGameReminderScheduler({ now });

    expect(result.sent).toBe(1);
    expect(sendGameReminderEmailMock).toHaveBeenCalledTimes(1);
    expect(sendGameReminderEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        game: expect.objectContaining({ id: 10 }),
        recipient: expect.objectContaining({ userId: "user-1", email: "player@example.com" }),
      })
    );
    expect(state.game_reminder_deliveries).toMatchObject([
      {
        game_id: 10,
        user_id: "user-1",
        booking_id: 100,
        status: "sent",
        attempts: 1,
        provider_message_id: "email-1",
      },
    ]);

    await runGameReminderScheduler({ now });
    expect(sendGameReminderEmailMock).toHaveBeenCalledTimes(1);
  });

  it("supports completed wallet bookings without a SumUp payment", async () => {
    seedBaseRows({
      payment: null,
      wallet: {
        booking_id: 100,
        transaction_type: "wallet_booking_payment",
        status: "completed",
        amount: -5,
      },
    });

    const result = await runGameReminderScheduler({ now });

    expect(result.sent).toBe(1);
    expect(sendGameReminderEmailMock).toHaveBeenCalledTimes(1);
  });

  it("excludes cancelled, archived, legacy, past and unconfirmed games", async () => {
    seedBaseRows({ game: { status: "cancelled" } });
    await runGameReminderScheduler({ now });

    seedBaseRows({ game: { archived_at: "2026-07-22T10:00:00.000Z" } });
    await runGameReminderScheduler({ now });

    seedBaseRows({ game: { starts_at: null } });
    await runGameReminderScheduler({ now });

    seedBaseRows({ game: { starts_at: "2026-07-22T11:00:00.000Z" } });
    await runGameReminderScheduler({ now });

    seedBaseRows({ payment: { payment_status: "pending" } });
    await runGameReminderScheduler({ now });

    expect(sendGameReminderEmailMock).not.toHaveBeenCalled();
  });

  it("uses the daily Hobby reminder window of 6 to 36 hours before kickoff", async () => {
    seedBaseRows({ game: { starts_at: "2026-07-22T17:59:59.000Z" } });
    await runGameReminderScheduler({ now });

    seedBaseRows({ game: { starts_at: "2026-07-24T00:00:01.000Z" } });
    await runGameReminderScheduler({ now });

    expect(sendGameReminderEmailMock).not.toHaveBeenCalled();

    seedBaseRows({ game: { starts_at: "2026-07-22T18:00:01.000Z" } });
    let result = await runGameReminderScheduler({ now });

    expect(result.sent).toBe(1);

    sendGameReminderEmailMock.mockClear();
    state.game_reminder_deliveries = [];
    seedBaseRows({ game: { starts_at: "2026-07-24T00:00:00.000Z" } });
    result = await runGameReminderScheduler({ now });

    expect(result.sent).toBe(1);
    expect(sendGameReminderEmailMock).toHaveBeenCalledTimes(1);
  });

  it("stores sanitized failure diagnostics and schedules a retry", async () => {
    seedBaseRows();
    sendGameReminderEmailMock.mockRejectedValueOnce(
      new Error("Resend failed for player@example.com with Bearer secret-token")
    );

    const result = await runGameReminderScheduler({ now });

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(state.game_reminder_deliveries[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      sanitized_error_code: "Error",
    });
    expect(state.game_reminder_deliveries[0].sanitized_error_message).toContain("[redacted-email]");
    expect(state.game_reminder_deliveries[0].sanitized_error_message).toContain("Bearer [redacted]");
  });
});
