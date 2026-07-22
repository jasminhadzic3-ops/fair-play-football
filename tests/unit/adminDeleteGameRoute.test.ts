import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/gameCancellation", () => ({
  cancelGameWithWalletCredits: vi.fn(),
  GameCancellationError: class GameCancellationError extends Error {
    status = 500;
  },
  retryGameCancellationEmails: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { DELETE } from "@/app/api/admin/games/[id]/route";

type TableName =
  | "bookings"
  | "booking_payments"
  | "wallet_transactions"
  | "waiting_list"
  | "waiting_list_notifications"
  | "game_reminder_deliveries"
  | "sumup_refund_attempts"
  | "games";
type TableRow = Record<string, unknown>;
type Filter =
  | { type: "eq"; field: string; value: unknown }
  | { type: "in"; field: string; values: unknown[] };
type QueryError = { message: string };

const state: Record<TableName, TableRow[]> = {
  bookings: [],
  booking_payments: [],
  wallet_transactions: [],
  waiting_list: [],
  waiting_list_notifications: [],
  game_reminder_deliveries: [],
  sumup_refund_attempts: [],
  games: [],
};
let queryErrors: Partial<Record<TableName, QueryError>> = {};

function getFieldValue(row: TableRow, field: string) {
  if (field.startsWith("metadata->>")) {
    const key = field.slice("metadata->>".length);
    const metadata = row.metadata as Record<string, unknown> | null | undefined;
    const value = metadata?.[key];

    return value == null ? value : String(value);
  }

  return row[field];
}

function applyFilters(rows: TableRow[], filters: Filter[]) {
  return filters.reduce((filteredRows, filter) => {
    if (filter.type === "eq") {
      return filteredRows.filter((row) => getFieldValue(row, filter.field) === filter.value);
    }

    return filteredRows.filter((row) => filter.values.includes(getFieldValue(row, filter.field)));
  }, rows);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];
  private shouldDelete = false;

  constructor(private table: TableName) {}

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

  delete() {
    this.shouldDelete = true;
    return this;
  }

  then<TResult1 = { data: TableRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: QueryError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    if (queryErrors[this.table]) {
      return Promise.resolve({
        data: [],
        error: queryErrors[this.table] ?? null,
      }).then(onfulfilled, onrejected);
    }

    const rows = applyFilters(state[this.table], this.filters);

    if (this.shouldDelete) {
      const rowsToDelete = new Set(rows);
      state[this.table] = state[this.table].filter((row) => !rowsToDelete.has(row));
    }

    return Promise.resolve({
      data: rows,
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

function deleteRequest(gameId: number) {
  return DELETE(
    new Request(`http://localhost/api/admin/games/${gameId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer token",
      },
    }) as Parameters<typeof DELETE>[0],
    { params: Promise.resolve({ id: String(gameId) }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation((table: TableName) => new MockSupabaseQuery(table));
  state.games = [{ id: 1 }, { id: 2 }];
  state.bookings = [];
  state.booking_payments = [];
  state.wallet_transactions = [];
  state.waiting_list = [];
  state.waiting_list_notifications = [];
  state.game_reminder_deliveries = [];
  state.sumup_refund_attempts = [];
  queryErrors = {};
});

describe("admin delete game route", () => {
  it("returns specific block reasons and preserves existing records", async () => {
    state.bookings = [{ id: 100, game_id: 1 }];
    state.booking_payments = [{ id: 200, game_id: 1, payment_status: "paid", amount: 8 }];
    state.wallet_transactions = [
      { id: 300, game_id: 1, transaction_type: "game_cancelled_credit", status: "completed", amount: 8 },
      { id: 301, game_id: 1, transaction_type: "refund_requested", status: "pending", amount: -8 },
    ];
    state.waiting_list = [{ id: 400, game_id: 1 }];
    state.game_reminder_deliveries = [{ id: 500, game_id: 1 }];
    state.sumup_refund_attempts = [{ id: 600, booking_payment_id: 200, refund_request_id: 301, status: "unknown" }];

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.delete_block_reasons).toEqual(
      expect.arrayContaining([
        "1 booking",
        "1 paid payment",
        "1 cancellation credit",
        "1 pending refund",
        "1 reminder delivery",
        "1 unresolved refund attempt",
      ])
    );
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
    expect(state.wallet_transactions).toHaveLength(2);
  });

  it("deletes only a truly empty game", async () => {
    const response = await deleteRequest(2);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(state.games).toEqual([{ id: 1 }]);
  });

  it("blocks deletion when legacy wallet history points at the game through metadata", async () => {
    state.wallet_transactions = [
      {
        id: 700,
        game_id: null,
        booking_id: null,
        payment_id: null,
        transaction_type: "game_cancelled_credit",
        status: "completed",
        amount: 5,
        metadata: { original_game_id: 1 },
      },
    ];

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.delete_block_reasons).toContain("1 cancellation credit");
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("blocks deletion when wallet history points at bookings or payments from the game", async () => {
    state.bookings = [{ id: 100, game_id: 1 }];
    state.booking_payments = [{ id: 200, game_id: 1, payment_status: "unpaid", amount: 0 }];
    state.wallet_transactions = [
      {
        id: 701,
        game_id: null,
        booking_id: 100,
        payment_id: null,
        transaction_type: "wallet_booking_payment",
        status: "completed",
        amount: -5,
      },
      {
        id: 702,
        game_id: null,
        booking_id: null,
        payment_id: 200,
        transaction_type: "game_cancelled_credit",
        status: "completed",
        amount: 5,
      },
    ];

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.delete_block_reasons).toEqual(
      expect.arrayContaining(["1 booking", "1 wallet booking", "1 cancellation credit"])
    );
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("blocks deletion when completed refund metadata links to a game refund request", async () => {
    state.wallet_transactions = [
      {
        id: 800,
        game_id: 1,
        booking_id: null,
        payment_id: null,
        transaction_type: "refund_requested",
        status: "pending",
        amount: -5,
      },
      {
        id: 801,
        game_id: null,
        booking_id: null,
        payment_id: null,
        transaction_type: "refund_completed",
        status: "completed",
        amount: -5,
        metadata: { refund_request_id: 800 },
      },
    ];

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.delete_block_reasons).toEqual(
      expect.arrayContaining(["1 pending refund", "1 completed refund"])
    );
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("blocks deletion when waiting-list notifications link through the waiting-list row", async () => {
    state.waiting_list = [{ id: 900, game_id: 1 }];
    state.waiting_list_notifications = [{ id: 901, game_id: null, waiting_list_id: 900 }];

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.delete_block_reasons).toEqual(
      expect.arrayContaining(["1 waiting-list entry", "1 waiting-list notification"])
    );
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("fails closed when a secondary preflight query fails", async () => {
    state.waiting_list = [{ id: 900, game_id: 1 }];
    queryErrors.waiting_list_notifications = { message: "notification lookup failed" };

    const response = await deleteRequest(1);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("notification lookup failed");
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("fails closed when a delete preflight query fails", async () => {
    queryErrors.wallet_transactions = { message: "wallet lookup failed" };

    const response = await deleteRequest(2);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("wallet lookup failed");
    expect(state.games).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
