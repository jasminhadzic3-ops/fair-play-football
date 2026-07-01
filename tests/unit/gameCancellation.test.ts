import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const creditWalletMock = vi.hoisted(() => vi.fn());
const sendGameCancelledEmailsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/wallet", () => ({
  creditWallet: creditWalletMock,
}));

vi.mock("@/lib/email/gameCancelled", () => ({
  sendGameCancelledEmails: sendGameCancelledEmailsMock,
}));

import { cancelGameWithWalletCredits } from "@/lib/gameCancellation";

type GameRow = {
  id: number;
  title: string | null;
  status: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

type BookingRow = {
  id: number;
  game_id: number;
  user_id: string | null;
  player_name: string | null;
};

type PaymentRow = {
  id: number;
  game_id: number;
  user_id: string | null;
  booking_id: number | null;
  amount: number | string | null;
  currency: string | null;
  payment_status: string | null;
};

type WalletTransactionRow = {
  id: number;
  game_id: number;
  user_id: string | null;
  booking_id: number | null;
  amount: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
};

type TableRow = GameRow | BookingRow | PaymentRow | WalletTransactionRow;

type Filter =
  | { type: "eq"; field: string; value: unknown }
  | { type: "neq"; field: string; value: unknown }
  | { type: "in"; field: string; values: unknown[] }
  | { type: "gt"; field: string; value: number }
  | { type: "lt"; field: string; value: number }
  | { type: "not_null"; field: string };

type MockDbState = {
  game: GameRow | null;
  bookings: BookingRow[];
  payments: PaymentRow[];
  walletTransactions: WalletTransactionRow[];
  updateCalls: Array<Record<string, unknown>>;
};

const defaultGame: GameRow = {
  id: 10,
  title: "Friday Football",
  status: "active",
  cancelled_at: null,
  cancelled_by: null,
  cancellation_reason: null,
};

const state: MockDbState = {
  game: null,
  bookings: [],
  payments: [],
  walletTransactions: [],
  updateCalls: [],
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
    case "booking_payments":
      return state.payments;
    case "wallet_transactions":
      return state.walletTransactions;
    default:
      throw new Error(`Unexpected Supabase table: ${table}`);
  }
}

function applyFilters(rows: TableRow[], filters: Filter[]) {
  return filters.filter(Boolean).reduce((filteredRows, filter) => {
    switch (filter.type) {
      case "eq":
        return filteredRows.filter((row) => getRowField(row, filter.field) === filter.value);
      case "neq":
        return filteredRows.filter((row) => getRowField(row, filter.field) !== filter.value);
      case "in":
        return filteredRows.filter((row) => filter.values.includes(getRowField(row, filter.field)));
      case "gt":
        return filteredRows.filter((row) => Number(getRowField(row, filter.field)) > filter.value);
      case "lt":
        return filteredRows.filter((row) => Number(getRowField(row, filter.field)) < filter.value);
      case "not_null":
        return filteredRows.filter((row) => {
          const value = getRowField(row, filter.field);
          return value !== null && value !== undefined;
        });
    }
  }, rows);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];
  private updatePayload: Record<string, unknown> | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ type: "eq", field, value });
    return this;
  }

  neq(field: string, value: unknown) {
    this.filters.push({ type: "neq", field, value });
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push({ type: "in", field, values });
    return this;
  }

  gt(field: string, value: number) {
    this.filters.push({ type: "gt", field, value });
    return this;
  }

  lt(field: string, value: number) {
    this.filters.push({ type: "lt", field, value });
    return this;
  }

  not(field: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push({ type: "not_null", field });
      return this;
    }

    throw new Error(`Unexpected Supabase not filter: ${field} ${operator} ${String(value)}`);
  }

  order() {
    return this;
  }

  async maybeSingle<T>() {
    if (this.updatePayload) {
      return this.updateMaybeSingle<T>();
    }

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

  private async updateMaybeSingle<T>() {
    if (this.table !== "games") {
      throw new Error(`Unexpected mocked update table: ${this.table}`);
    }

    const [matchedGame] = applyFilters(tableRows(this.table), this.filters) as GameRow[];

    if (!matchedGame) {
      return { data: null as T | null, error: null };
    }

    state.updateCalls.push(this.updatePayload ?? {});
    state.game = {
      ...matchedGame,
      ...this.updatePayload,
    } as GameRow;

    return { data: state.game as T, error: null };
  }
}

function resetDb(overrides: Partial<MockDbState> = {}) {
  state.game = overrides.game === undefined ? { ...defaultGame } : overrides.game;
  state.bookings = overrides.bookings ?? [];
  state.payments = overrides.payments ?? [];
  state.walletTransactions = overrides.walletTransactions ?? [];
  state.updateCalls = [];
}

function booking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 100,
    game_id: 10,
    user_id: "user-1",
    player_name: "Player One",
    ...overrides,
  };
}

function paidPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 200,
    game_id: 10,
    user_id: "user-1",
    booking_id: 100,
    amount: 8,
    currency: "GBP",
    payment_status: "paid",
    ...overrides,
  };
}

function walletDebit(overrides: Partial<WalletTransactionRow> = {}): WalletTransactionRow {
  return {
    id: 300,
    game_id: 10,
    user_id: "user-1",
    booking_id: 100,
    amount: -8,
    currency: "GBP",
    transaction_type: "wallet_booking_payment",
    status: "completed",
    ...overrides,
  };
}

async function cancelGame() {
  return cancelGameWithWalletCredits({
    gameId: 10,
    adminUserId: "admin-1",
    cancellationReason: "Weather",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseFromMock.mockImplementation((table: string) => new MockSupabaseQuery(table));
  creditWalletMock.mockResolvedValue({ id: 999 });
  sendGameCancelledEmailsMock.mockResolvedValue({ skipped: false, sentCount: 1 });
  resetDb();
});

describe("cancelGameWithWalletCredits", () => {
  it("credits exactly one current SumUp paid booking", async () => {
    resetDb({
      bookings: [booking()],
      payments: [paidPayment()],
    });

    const result = await cancelGame();

    expect(creditWalletMock).toHaveBeenCalledTimes(1);
    expect(creditWalletMock).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 8,
      currency: "GBP",
      transactionType: "game_cancelled_credit",
      gameId: 10,
      bookingId: 100,
      paymentId: 200,
      idempotencyKey: "game_cancelled_credit:game:10:payment:200",
      description: "Credit for cancelled game: Friday Football",
      adminNote: "Weather",
      metadata: {
        original_payment_method: "sumup",
        cancelled_by: "admin-1",
      },
    });
    expect(result.sumup_credited_count).toBe(1);
    expect(result.wallet_credited_count).toBe(0);
    expect(result.total_credited_count).toBe(1);
    expect(state.updateCalls).toHaveLength(1);
    expect(sendGameCancelledEmailsMock).toHaveBeenCalledWith({ gameId: 10 });
  });

  it("restores exactly one current wallet-paid booking debit", async () => {
    resetDb({
      bookings: [booking()],
      walletTransactions: [walletDebit()],
    });

    const result = await cancelGame();

    expect(creditWalletMock).toHaveBeenCalledTimes(1);
    expect(creditWalletMock).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 8,
      currency: "GBP",
      transactionType: "game_cancelled_credit",
      gameId: 10,
      bookingId: 100,
      idempotencyKey: "game_cancelled_credit:game:10:wallet_transaction:300",
      description: "Credit for cancelled game: Friday Football",
      adminNote: "Weather",
      metadata: {
        original_payment_method: "wallet",
        original_wallet_transaction_id: 300,
        cancelled_by: "admin-1",
      },
    });
    expect(result.sumup_credited_count).toBe(0);
    expect(result.wallet_credited_count).toBe(1);
    expect(result.total_credited_count).toBe(1);
    expect(state.updateCalls).toHaveLength(1);
  });

  it("ignores old moved or removed payment records not linked to current booking ids", async () => {
    resetDb({
      bookings: [booking()],
      payments: [
        paidPayment({ id: 201, booking_id: 999 }),
        paidPayment({ id: 202, booking_id: null }),
      ],
      walletTransactions: [
        walletDebit({ id: 301, booking_id: 999 }),
        walletDebit({ id: 302, booking_id: null }),
      ],
    });

    const result = await cancelGame();

    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(result.total_credited_count).toBe(0);
    expect(state.updateCalls).toHaveLength(1);
    expect(sendGameCancelledEmailsMock).toHaveBeenCalledTimes(1);
  });

  it("skips a current booking with no valid paid record and still cancels", async () => {
    resetDb({
      bookings: [booking()],
    });

    const result = await cancelGame();

    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(result.total_credited_count).toBe(0);
    expect(state.game?.status).toBe("cancelled");
    expect(sendGameCancelledEmailsMock).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate SumUp paid rows for one booking without crediting or emailing", async () => {
    resetDb({
      bookings: [booking()],
      payments: [paidPayment({ id: 201 }), paidPayment({ id: 202 })],
    });

    await expect(cancelGame()).rejects.toMatchObject({
      name: "GameCancellationError",
      status: 409,
      message: expect.stringContaining("multiple paid SumUp payment records"),
    });
    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("blocks duplicate wallet debits for one booking", async () => {
    resetDb({
      bookings: [booking()],
      walletTransactions: [walletDebit({ id: 301 }), walletDebit({ id: 302 })],
    });

    await expect(cancelGame()).rejects.toMatchObject({
      name: "GameCancellationError",
      status: 409,
      message: expect.stringContaining("multiple wallet booking payment records"),
    });
    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("blocks a booking with both SumUp and wallet payment records", async () => {
    resetDb({
      bookings: [booking()],
      payments: [paidPayment()],
      walletTransactions: [walletDebit()],
    });

    await expect(cancelGame()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("both SumUp and wallet payment records"),
    });
    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("blocks user mismatch between current booking and payment record", async () => {
    resetDb({
      bookings: [booking({ user_id: "user-1" })],
      payments: [paidPayment({ user_id: "user-2" })],
    });

    await expect(cancelGame()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("mismatched user details"),
    });
    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("prevents game status update and email if credit creation fails", async () => {
    creditWalletMock.mockRejectedValue(new Error("credit failed"));
    resetDb({
      bookings: [booking()],
      payments: [paidPayment()],
    });

    await expect(cancelGame()).rejects.toThrow("credit failed");
    expect(creditWalletMock).toHaveBeenCalledTimes(1);
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("does not roll back cancellation when email fails and returns an email warning", async () => {
    sendGameCancelledEmailsMock.mockRejectedValue(new Error("resend down"));
    resetDb({
      bookings: [booking()],
      payments: [paidPayment()],
    });

    const result = await cancelGame();

    expect(creditWalletMock).toHaveBeenCalledTimes(1);
    expect(state.game?.status).toBe("cancelled");
    expect(result.email_warning).toBe("resend down");
  });

  it("returns success with zero credits and no email for an already-cancelled game", async () => {
    resetDb({
      game: {
        ...defaultGame,
        status: "cancelled",
        cancelled_at: "2026-07-01T10:00:00.000Z",
      },
      bookings: [booking()],
      payments: [paidPayment()],
    });

    const result = await cancelGame();

    expect(result.already_cancelled).toBe(true);
    expect(result.total_credited_count).toBe(0);
    expect(creditWalletMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });
});
