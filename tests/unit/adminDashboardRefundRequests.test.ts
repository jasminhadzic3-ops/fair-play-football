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
  | "waiting_list"
  | "game_reminder_deliveries"
  | "waiting_list_notifications";

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
  game_reminder_deliveries: [],
  waiting_list_notifications: [],
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
  delete process.env.E2E_ALLOW_DB_MUTATION;
  delete process.env.E2E_MOCK_SUMUP_REFUNDS;
  delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
  delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
  delete process.env.SUMUP_SANDBOX_REFUNDS_ENABLED;
  delete process.env.SUMUP_API_KEY;
  delete process.env.SUMUP_MERCHANT_CODE;
  delete process.env.SUMUP_CURRENCY;
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation((table: TableName) => new MockSupabaseQuery(table));

  state.games = [];
  state.games = [
    {
      id: 10,
      title: "Friday Football",
      location: "Pitch 1",
      time: "15 Jul 2026, 20:30",
      starts_at: "2026-07-15T19:30:00.000Z",
      max_players: 12,
      status: "active",
    },
  ];
  state.bookings = [
    {
      id: 100,
      game_id: 10,
      user_id: "user-1",
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
      user_id: "user-1",
      game_id: 10,
      payment_status: "paid",
      booking_id: 100,
      amount: 8,
      currency: "GBP",
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
      game_id: 10,
      booking_id: 100,
      amount: -8,
      currency: "GBP",
      transaction_type: "wallet_booking_payment",
      status: "completed",
      created_at: "2026-07-01T09:00:00.000Z",
    },
  ];
  state.waiting_list = [];
  state.game_reminder_deliveries = [];
  state.waiting_list_notifications = [];
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
    expect(body.games[0].admin_safety).toEqual(
      expect.objectContaining({
        bookings_count: 1,
        spaces_remaining: 11,
        paid_sumup_payments_count: 1,
        wallet_bookings_count: 1,
        pending_refund_requests_count: 1,
        has_financial_history: true,
        has_refunds: true,
        safe_to_delete: false,
        delete_block_reasons: expect.arrayContaining(["1 booking", "1 paid payment", "1 wallet booking", "1 pending refund"]),
      })
    );
    expect(body.automaticSumUpRefundMockEnabled).toBe(false);
    expect(body.automaticSumUpRefundEnabled).toBe(false);
    expect(body.automaticSumUpRefundMode).toBe("disabled");
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
    expect(body.automaticSumUpRefundEnabled).toBe(false);
    expect(body.automaticSumUpRefundMode).toBe("disabled");
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
    expect(body.automaticSumUpRefundEnabled).toBe(true);
    expect(body.automaticSumUpRefundMode).toBe("test_mock");
  });

  it("enables local sandbox real SumUp refunds only with the complete sandbox gate", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";
    process.env.SUMUP_API_KEY = "sandbox-key";
    process.env.SUMUP_MERCHANT_CODE = "MY4BGACH";
    process.env.SUMUP_CURRENCY = "GBP";
    delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "preview");

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundMockEnabled).toBe(false);
    expect(body.automaticSumUpRefundEnabled).toBe(true);
    expect(body.automaticSumUpRefundMode).toBe("local_sandbox_real");
  });

  it("refuses local sandbox real SumUp refunds in production contexts", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";
    process.env.SUMUP_API_KEY = "sandbox-key";
    process.env.SUMUP_MERCHANT_CODE = "MY4BGACH";
    process.env.SUMUP_CURRENCY = "GBP";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundEnabled).toBe(false);
    expect(body.automaticSumUpRefundMode).toBe("disabled");
  });

  it("does not enable real SumUp refunds without the explicit production gate", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";
    delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundEnabled).toBe(false);
    expect(body.automaticSumUpRefundMode).toBe("disabled");
  });

  it("does not enable production real refunds when the sandbox flag is present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundEnabled).toBe(false);
    expect(body.automaticSumUpRefundMode).toBe("disabled");
  });

  it("enables real SumUp refunds only with the production real gate", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.automaticSumUpRefundMockEnabled).toBe(false);
    expect(body.automaticSumUpRefundEnabled).toBe(true);
    expect(body.automaticSumUpRefundMode).toBe("production_real");
  });

  it("includes sanitized eligible admin refund candidates for SumUp cancellation credits", async () => {
    state.games = [
      {
        id: 10,
        title: "Cancelled Football",
        location: "Pitch 1",
        time: "15 Jul 2026, 20:30",
        starts_at: "2026-07-15T19:30:00.000Z",
        max_players: 12,
        status: "cancelled",
      },
    ];
    state.wallet_transactions = [
      {
        id: 900,
        user_id: "user-1",
        game_id: 10,
        booking_id: 100,
        payment_id: 200,
        amount: 8,
        currency: "GBP",
        transaction_type: "game_cancelled_credit",
        status: "completed",
        metadata: {
          original_payment_method: "sumup",
          original_payment_id: 200,
          original_game_id: 10,
          original_booking_id: 100,
        },
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.games[0].refund_candidates).toEqual([
      expect.objectContaining({
        source_wallet_transaction_id: 900,
        game_id: 10,
        booking_id: 100,
        payment_id: 200,
        user_id: "user-1",
        player_name: "Refund Player",
        amount: 8,
        currency: "GBP",
        original_payment_method: "sumup",
        refund_status: "eligible",
        refund_eligible: true,
        safe_reason: "Eligible for full SumUp refund.",
      }),
    ]);
    expect(body.games[0].refund_candidates[0]).not.toHaveProperty("transaction_code");
    expect(body.games[0].refund_candidates[0]).not.toHaveProperty("sumup_transaction_id");
    expect(body.games[0].refund_candidates[0]).not.toHaveProperty("raw_checkout");
    expect(body.games[0].refund_candidates[0]).not.toHaveProperty("metadata");
  });

  it("marks wallet cancellation credits as not eligible for Admin SumUp refunds", async () => {
    state.games = [
      {
        id: 10,
        title: "Cancelled Football",
        location: "Pitch 1",
        time: "15 Jul 2026, 20:30",
        starts_at: "2026-07-15T19:30:00.000Z",
        max_players: 12,
        status: "cancelled",
      },
    ];
    state.wallet_transactions = [
      {
        id: 901,
        user_id: "user-1",
        game_id: 10,
        booking_id: 100,
        payment_id: null,
        amount: 8,
        currency: "GBP",
        transaction_type: "game_cancelled_credit",
        status: "completed",
        metadata: {
          original_payment_method: "wallet",
          original_game_id: 10,
          original_booking_id: 100,
        },
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];

    const request = new Request("http://localhost/api/admin/dashboard", {
      headers: {
        Authorization: "Bearer token",
      },
    });

    const response = await GET(request as Parameters<typeof GET>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.games[0].refund_candidates).toEqual([
      expect.objectContaining({
        source_wallet_transaction_id: 901,
        refund_status: "not_eligible",
        refund_eligible: false,
        safe_reason: "Only SumUp cancellation credits can be refunded to card.",
      }),
    ]);
  });
});
