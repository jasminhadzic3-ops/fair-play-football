import { beforeEach, describe, expect, it, vi } from "vitest";

const createSumUpCheckoutMock = vi.hoisted(() => vi.fn());
const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  createSumUpCheckout: createSumUpCheckoutMock,
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { POST } from "@/app/api/sumup/create-checkout/route";

type TableName = "games" | "bookings" | "booking_payments";
type TableRow = Record<string, unknown>;
type Filter = { type: "eq"; field: string; value: unknown } | { type: "in"; field: string; values: unknown[] };

const state: Record<TableName, TableRow[]> = {
  games: [],
  bookings: [],
  booking_payments: [],
};

function applyFilters(rows: TableRow[], filters: Filter[]) {
  return filters.reduce((filteredRows, filter) => {
    if (filter.type === "eq") {
      return filteredRows.filter((row) => row[filter.field] === filter.value);
    }

    return filteredRows.filter((row) => filter.values.includes(row[filter.field]));
  }, rows);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];

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

  order() {
    return this;
  }

  limit() {
    return this;
  }

  insert() {
    return this;
  }

  async single<T>() {
    const rows = applyFilters(state[this.table], this.filters);

    return { data: (rows[0] ?? null) as T | null, error: rows[0] ? null : { message: "not found" } };
  }

  async maybeSingle<T>() {
    const rows = applyFilters(state[this.table], this.filters);

    return { data: (rows[0] ?? null) as T | null, error: null };
  }

  then<TResult1 = { data: TableRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({
      data: applyFilters(state[this.table], this.filters),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

function checkoutRequest(gameId = 10) {
  return new Request("http://localhost/api/sumup/create-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gameId, playerName: "Test Player" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUMUP_API_KEY = "sumup-key";
  process.env.SUMUP_MERCHANT_CODE = "merchant";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.SUMUP_CURRENCY = "GBP";
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email_confirmed_at: "2026-07-01T10:00:00.000Z",
  });
  supabaseFromMock.mockImplementation((table: TableName) => new MockSupabaseQuery(table));
  state.games = [];
  state.bookings = [];
  state.booking_payments = [];
});

describe("SumUp checkout creation", () => {
  it("rejects archived games before creating a SumUp checkout", async () => {
    state.games = [
      {
        id: 10,
        title: "Archived Football",
        location: "Pitch 1",
        time: "Friday 8pm",
        price: 5,
        status: "active",
        archived_at: "2026-07-22T10:00:00.000Z",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("archived");
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });
});
