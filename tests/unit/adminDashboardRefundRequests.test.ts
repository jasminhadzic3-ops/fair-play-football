import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

import { GET } from "@/app/api/admin/dashboard/route";

type TableName =
  | "games"
  | "bookings"
  | "profiles"
  | "booking_payments"
  | "wallet_transactions"
  | "waiting_list";

type TableRow = Record<string, unknown>;

type Filter =
  | { type: "eq"; field: string; value: unknown }
  | { type: "lt"; field: string; value: number };

const state: Record<TableName, TableRow[]> = {
  games: [],
  bookings: [],
  profiles: [],
  booking_payments: [],
  wallet_transactions: [],
  waiting_list: [],
};

function applyFilters(rows: TableRow[], filters: Filter[]) {
  return filters.reduce((filteredRows, filter) => {
    switch (filter.type) {
      case "eq":
        return filteredRows.filter((row) => row[filter.field] === filter.value);
      case "lt":
        return filteredRows.filter((row) => Number(row[filter.field]) < filter.value);
    }
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

  lt(field: string, value: number) {
    this.filters.push({ type: "lt", field, value });
    return this;
  }

  order() {
    return this;
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

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation((table: TableName) => new MockSupabaseQuery(table));

  state.games = [];
  state.bookings = [];
  state.profiles = [
    {
      id: "user-1",
      email: "player@example.com",
      username: "Refund Player",
    },
  ];
  state.booking_payments = [];
  state.wallet_transactions = [
    {
      id: 501,
      user_id: "user-1",
      amount: -8,
      currency: "GBP",
      transaction_type: "refund_requested",
      status: "pending",
      description: "Refund requested",
      metadata: {
        source: "wallet_refund_request_api",
        requested_balance: 8,
      },
      created_at: "2026-07-01T10:00:00.000Z",
    },
    {
      id: 502,
      user_id: "user-1",
      amount: -8,
      currency: "GBP",
      transaction_type: "wallet_booking_payment",
      status: "completed",
      created_at: "2026-07-01T09:00:00.000Z",
    },
  ];
  state.waiting_list = [];
});

describe("admin dashboard refund requests", () => {
  it("includes pending refund requests enriched with profile details", async () => {
    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.refund_requests).toEqual([
      expect.objectContaining({
        id: 501,
        user_id: "user-1",
        amount: -8,
        currency: "GBP",
        transaction_type: "refund_requested",
        status: "pending",
        player_name: "Refund Player",
        player_email: "player@example.com",
      }),
    ]);
    expect(body.wallet_transactions).toEqual([
      expect.objectContaining({
        id: 502,
        transaction_type: "wallet_booking_payment",
      }),
    ]);
  });
});
