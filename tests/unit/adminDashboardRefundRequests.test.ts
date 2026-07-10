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
  | "sumup_refund_attempts"
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
  sumup_refund_attempts: [],
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
  vi.unstubAllEnvs();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation((table: TableName) => new MockSupabaseQuery(table));

  state.games = [];
  state.games = [
    {
      id: 10,
      title: "Friday Football",
    },
  ];
  state.bookings = [
    {
      id: 100,
      player_name: "Booked Player",
    },
  ];
  state.profiles = [
    {
      id: "user-1",
      email: "player@example.com",
      username: "Refund Player",
    },
  ];
  state.booking_payments = [
    {
      id: 200,
      payment_status: "paid",
      amount: 8,
      checkout_reference: "checkout-reference-1",
      transaction_code: "TXN-1",
    },
  ];
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
        source_wallet_transaction_id: 900,
        source_transaction_type: "game_cancelled_credit",
        original_payment_method: "sumup",
        original_payment_id: 200,
        original_game_id: 10,
        original_booking_id: 100,
        refund_mode: "source_credit",
        automatic_refund_eligible: true,
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
  state.sumup_refund_attempts = [];
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
        source_wallet_transaction_id: 900,
        original_payment_id: 200,
        original_game_id: 10,
        original_booking_id: 100,
        source_game_title: "Friday Football",
        source_booking_player_name: "Booked Player",
        source_payment_status: "paid",
        source_payment_checkout_reference: "checkout-reference-1",
        source_payment_transaction_code: "TXN-1",
      }),
    ]);
    expect(body.wallet_transactions).toEqual([
      expect.objectContaining({
        id: 502,
        transaction_type: "wallet_booking_payment",
      }),
    ]);
    expect(body.automaticSumUpRefundMockEnabled).toBe(false);
  });

  it("does not enable mocked automatic SumUp refunds without the complete TEST mock gate", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
    process.env.E2E_ALLOW_DB_MUTATION = "true";
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundMockEnabled).toBe(false);
  });

  it("enables mocked automatic SumUp refunds only with the complete TEST mock gate", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
    process.env.E2E_ALLOW_DB_MUTATION = "true";
    process.env.E2E_MOCK_SUMUP_REFUNDS = "true";

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundMockEnabled).toBe(true);
  });
});
