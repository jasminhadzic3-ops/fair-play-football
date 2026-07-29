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

type TableName = "games" | "bookings" | "booking_payments" | "wallet_transactions";
type TableRow = Record<string, unknown>;
type Filter = { type: "eq"; field: string; value: unknown } | { type: "in"; field: string; values: unknown[] };

const state: Record<TableName, TableRow[]> = {
  games: [],
  bookings: [],
  booking_payments: [],
  wallet_transactions: [],
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

  insert(row: TableRow) {
    state[this.table].push(row);
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
  const request = new Request("http://localhost/api/sumup/create-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gameId, playerName: "Test Player" }),
  });

  return Object.assign(request, {
    nextUrl: new URL(request.url),
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
  state.wallet_transactions = [];
  createSumUpCheckoutMock.mockImplementation(async () => ({
    id: `checkout-${createSumUpCheckoutMock.mock.calls.length}`,
    hosted_checkout_url: `https://checkout.sumup.test/${createSumUpCheckoutMock.mock.calls.length}`,
  }));
});

describe("SumUp checkout creation", () => {
  function activeGame() {
    state.games = [
      {
        id: 10,
        title: "Friday Football",
        location: "Pitch 1",
        time: "Friday 8pm",
        price: 5,
        status: "active",
        archived_at: null,
      },
    ];
  }

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

  it("blocks a second checkout for an active paid booking cycle", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: 301,
        checkout_id: "first-checkout",
        checkout_reference: "first-reference",
        hosted_checkout_url: "https://checkout.sumup.test/first",
        payment_status: "paid",
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("You have already paid for this game.");
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });

  it("blocks checkout when the user already has an active booking under another player name", async () => {
    activeGame();
    state.bookings = [
      {
        id: 301,
        user_id: "user-1",
        game_id: 10,
        player_name: "Old Display Name",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("You have already joined this game.");
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });

  it("blocks rebooking while a previous-name cancelled SumUp payment has an active refund request", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Old Display Name",
        booking_id: null,
        checkout_id: "refunding-checkout",
        checkout_reference: "refunding-reference",
        hosted_checkout_url: "https://checkout.sumup.test/refunding",
        payment_status: "paid",
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];
    state.wallet_transactions = [
      {
        id: 901,
        user_id: "user-1",
        game_id: 10,
        payment_id: 201,
        transaction_type: "refund_requested",
        status: "pending",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("previous refund");
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });

  it("resumes an active pending checkout for the current payment cycle", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: null,
        checkout_id: "pending-checkout",
        checkout_reference: "pending-reference",
        hosted_checkout_url: "https://checkout.sumup.test/pending",
        payment_status: "pending",
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checkout_id: "pending-checkout",
      checkout_reference: "pending-reference",
      hosted_checkout_url: "https://checkout.sumup.test/pending",
      payment_status: "pending",
    });
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });

  it("blocks rebooking while a cancelled SumUp payment has an active refund request", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: null,
        checkout_id: "refunding-checkout",
        checkout_reference: "refunding-reference",
        hosted_checkout_url: "https://checkout.sumup.test/refunding",
        payment_status: "paid",
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];
    state.wallet_transactions = [
      {
        id: 901,
        user_id: "user-1",
        game_id: 10,
        payment_id: 201,
        transaction_type: "refund_requested",
        status: "processing",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("previous refund");
    expect(createSumUpCheckoutMock).not.toHaveBeenCalled();
  });

  it("allows a new checkout after a cancelled SumUp payment has a completed refund", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: null,
        checkout_id: "first-checkout",
        checkout_reference: "first-reference",
        hosted_checkout_url: "https://checkout.sumup.test/first",
        payment_status: "paid",
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ];
    state.wallet_transactions = [
      {
        id: 901,
        user_id: "user-1",
        game_id: 10,
        payment_id: 201,
        transaction_type: "refund_requested",
        status: "completed",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkout_id).toBe("checkout-1");
    expect(body.checkout_reference).not.toBe("first-reference");
    expect(body.hosted_checkout_url).toBe("https://checkout.sumup.test/1");
    expect(createSumUpCheckoutMock).toHaveBeenCalledTimes(1);
    expect(state.booking_payments).toHaveLength(2);
    expect(state.booking_payments[1]).toMatchObject({
      user_id: "user-1",
      game_id: 10,
      player_name: "Test Player",
      checkout_id: "checkout-1",
      hosted_checkout_url: "https://checkout.sumup.test/1",
      payment_status: "pending",
    });
  });

  it("allows another new checkout after multiple completed refunded cycles", async () => {
    activeGame();
    state.booking_payments = [
      {
        id: 201,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: null,
        checkout_id: "first-checkout",
        checkout_reference: "first-reference",
        hosted_checkout_url: "https://checkout.sumup.test/first",
        payment_status: "paid",
        created_at: "2026-07-01T10:00:00.000Z",
      },
      {
        id: 202,
        user_id: "user-1",
        game_id: 10,
        player_name: "Test Player",
        booking_id: null,
        checkout_id: "second-checkout",
        checkout_reference: "second-reference",
        hosted_checkout_url: "https://checkout.sumup.test/second",
        payment_status: "paid",
        created_at: "2026-07-02T10:00:00.000Z",
      },
    ];
    state.wallet_transactions = [
      {
        id: 901,
        user_id: "user-1",
        game_id: 10,
        payment_id: 201,
        transaction_type: "refund_requested",
        status: "completed",
      },
      {
        id: 902,
        user_id: "user-1",
        game_id: 10,
        payment_id: 202,
        transaction_type: "refund_requested",
        status: "completed",
      },
    ];

    const response = await POST(checkoutRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkout_id).toBe("checkout-1");
    expect(body.checkout_reference).not.toBe("first-reference");
    expect(body.checkout_reference).not.toBe("second-reference");
    expect(createSumUpCheckoutMock).toHaveBeenCalledTimes(1);
  });
});
