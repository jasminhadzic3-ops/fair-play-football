import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const processAutomaticSumUpRefundMock = vi.hoisted(() => vi.fn());
const reconcileUnknownSumUpRefundAttemptMock = vi.hoisted(() => vi.fn());
const completeWalletRefundRequestMock = vi.hoisted(() => vi.fn());
const refundSumUpTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/sumupRefundProcessing", () => ({
  processAutomaticSumUpRefund: processAutomaticSumUpRefundMock,
}));

vi.mock("@/lib/sumupRefundReconciliation", () => ({
  reconcileUnknownSumUpRefundAttempt: reconcileUnknownSumUpRefundAttemptMock,
}));

vi.mock("@/lib/wallet", () => ({
  completeWalletRefundRequest: completeWalletRefundRequestMock,
}));

vi.mock("@/lib/sumupPayments", () => ({
  SumUpRefundHttpError: class SumUpRefundHttpError extends Error {
    status: number;
    responseBody: unknown;

    constructor(message: string, status: number, responseBody: unknown) {
      super(message);
      this.status = status;
      this.responseBody = responseBody;
    }
  },
  refundSumUpTransaction: refundSumUpTransactionMock,
}));

import { PATCH } from "@/app/api/admin/refund-requests/[id]/route";
import { SumUpRefundHttpError } from "@/lib/sumupPayments";

type RefundRequestRow = {
  id: number;
  user_id: string;
  amount: number | string;
  currency: string | null;
  transaction_type: string;
  status: string;
  admin_note: string | null;
  metadata: Record<string, unknown>;
};

type Filter = {
  field: string;
  value: unknown;
};

const state: {
  refundRequest: RefundRequestRow | null;
  updateCalls: Array<Record<string, unknown>>;
} = {
  refundRequest: null,
  updateCalls: [],
};

function matchesFilters(row: RefundRequestRow, filters: Filter[]) {
  return filters.every((filter) => (row as unknown as Record<string, unknown>)[filter.field] === filter.value);
}

class MockSupabaseQuery {
  private filters: Filter[] = [];
  private updatePayload: Record<string, unknown> | null = null;

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  async maybeSingle<T>() {
    if (!state.refundRequest || !matchesFilters(state.refundRequest, this.filters)) {
      return { data: null as T | null, error: null };
    }

    if (this.updatePayload) {
      state.updateCalls.push(this.updatePayload);
      state.refundRequest = {
        ...state.refundRequest,
        ...this.updatePayload,
      } as RefundRequestRow;
    }

    return { data: state.refundRequest as T, error: null };
  }
}

function requestBody(
  action: "approve" | "reject" | "refund_via_sumup" | "recheck_sumup_refund",
  reason = "Admin note"
) {
  return new Request("http://localhost/api/admin/refund-requests/501", {
    method: "PATCH",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, reason }),
  });
}

function routeContext(id = "501") {
  return {
    params: Promise.resolve({ id }),
  };
}

function defaultRefundRequest(overrides: Partial<RefundRequestRow> = {}): RefundRequestRow {
  return {
    id: 501,
    user_id: "user-1",
    amount: -8,
    currency: "GBP",
    transaction_type: "refund_requested",
    status: "pending",
    admin_note: null,
    metadata: {
      source: "wallet_refund_request_api",
      requested_balance: 8,
    },
    ...overrides,
  };
}

function enableProductionRealRefundMode() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
  vi.stubEnv("NODE_ENV", "production");
  delete process.env.E2E_ALLOW_DB_MUTATION;
  delete process.env.E2E_MOCK_SUMUP_REFUNDS;
  delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
  delete process.env.SUMUP_SANDBOX_REFUNDS_ENABLED;
  process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
  process.env.SUMUP_API_KEY = "sumup-key";
  process.env.SUMUP_MERCHANT_CODE = "merchant-1";
}

function enableLocalSandboxRealRefundMode() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "preview");
  delete process.env.E2E_ALLOW_DB_MUTATION;
  delete process.env.E2E_MOCK_SUMUP_REFUNDS;
  delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
  delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
  process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";
  process.env.SUMUP_API_KEY = "sandbox-key";
  process.env.SUMUP_MERCHANT_CODE = "MY4BGACH";
  process.env.SUMUP_CURRENCY = "GBP";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";
  process.env.E2E_ALLOW_DB_MUTATION = "true";
  process.env.E2E_MOCK_SUMUP_REFUNDS = "true";
  delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
  delete process.env.SUMUP_SANDBOX_REFUNDS_ENABLED;
  delete process.env.SUMUP_API_KEY;
  delete process.env.SUMUP_MERCHANT_CODE;
  delete process.env.SUMUP_CURRENCY;
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  supabaseFromMock.mockImplementation(() => new MockSupabaseQuery());
  processAutomaticSumUpRefundMock.mockResolvedValue({
    outcome: "completed",
    status: 200,
    message: "SumUp refund completed and wallet balance was updated.",
    attemptId: 900,
    refundRequestId: 501,
    refundTransactionId: 700,
    skippedSumUpRefundCall: false,
    balanceBreakdown: {
      completedBalance: 0,
      reservedRefundAmount: 0,
      availableBalance: 0,
    },
  });
  reconcileUnknownSumUpRefundAttemptMock.mockResolvedValue({
    status: 200,
    result: "refund_confirmed",
    message: "SumUp refund confirmed and wallet refund completed.",
    attemptId: 900,
    refundRequestId: 501,
    refundTransactionId: 700,
  });
  completeWalletRefundRequestMock.mockImplementation(async () => {
    if (state.refundRequest) {
      state.refundRequest = {
        ...state.refundRequest,
        status: "completed",
        admin_note: "Paid manually",
        metadata: {
          ...state.refundRequest.metadata,
          refund_completed_transaction_id: 700,
          processed_by: "admin-1",
        },
      };
    }

    return {
      success: true,
      refundRequestId: 501,
      refundTransactionId: 700,
      reason: null,
      completedBalance: 4,
      reservedRefundAmount: 0,
      availableBalance: 4,
    };
  });
  state.refundRequest = defaultRefundRequest();
  state.updateCalls = [];
});

describe("admin refund request route", () => {
  it("blocks non-admin users", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await PATCH(
      requestBody("approve") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(401);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(reconcileUnknownSumUpRefundAttemptMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("rechecks an unknown SumUp refund without issuing another refund call", async () => {
    state.refundRequest = defaultRefundRequest({
      status: "processing",
      metadata: {
        sumup_refund_attempt_id: 900,
      },
    });

    const response = await PATCH(
      requestBody("recheck_sumup_refund") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(reconcileUnknownSumUpRefundAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        refundRequestId: 501,
        adminUserId: "admin-1",
      })
    );
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      message: "SumUp refund confirmed and wallet refund completed.",
      result: "refund_confirmed",
      refund_request: {
        id: 501,
      },
      refund_transaction: {
        id: 700,
      },
      sumup_refund_attempt: {
        id: 900,
      },
    });
  });

  it("returns safe reconciliation responses without raw SumUp bodies or secrets", async () => {
    reconcileUnknownSumUpRefundAttemptMock.mockResolvedValue({
      status: 409,
      result: "manual_review",
      message: "Manual review is required.",
      attemptId: 900,
      refundRequestId: 501,
      raw_response: {
        authorization: "Bearer secret",
        card: "4242",
      },
    });

    const response = await PATCH(
      requestBody("recheck_sumup_refund") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      result: "manual_review",
      message: "Manual review is required.",
    });
    expect(serializedBody).not.toContain("secret");
    expect(serializedBody).not.toContain("4242");
    expect(serializedBody).not.toContain("raw_response");
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects a pending request without changing wallet balance", async () => {
    const response = await PATCH(
      requestBody("reject", "Customer asked to cancel") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(state.refundRequest).toMatchObject({
      status: "cancelled",
      admin_note: "Customer asked to cancel",
    });
    expect(body.refund_request.metadata).toMatchObject({
      rejected_by: "admin-1",
      rejection_reason: "Customer asked to cancel",
    });
  });

  it("approves a pending request with the refund completion RPC", async () => {
    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).toHaveBeenCalledTimes(1);
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      adminUserId: "admin-1",
      idempotencyKey: "refund_completed:request:501",
      description: "Refund completed",
      adminNote: "Paid manually",
      metadata: {
        refund_request_id: 501,
        processed_by: "admin-1",
        manual: true,
      },
    });
  });

  it("marks the approved request completed and links the debit transaction", async () => {
    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.refundRequest).toMatchObject({
      status: "completed",
      admin_note: "Paid manually",
    });
    expect(body.refund_request.metadata).toMatchObject({
      refund_completed_transaction_id: 700,
      processed_by: "admin-1",
    });
    expect(body.refund_transaction).toEqual({ id: 700 });
    expect(body.balance_breakdown).toEqual({
      completed_balance: 4,
      reserved_refund_amount: 0,
      available_balance: 4,
    });
  });

  it("runs the mocked automatic SumUp refund path without calling the real SumUp helper", async () => {
    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledTimes(1);
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      actorUserId: "admin-1",
      initiatedBy: "admin",
      refundDependency: expect.any(Function),
    });
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      message: "SumUp refund completed and wallet balance was updated.",
      refund_request: {
        id: 501,
        status: "completed",
      },
      sumup_refund_attempt: {
        id: 900,
        status: "succeeded",
        skipped_sumup_refund_call: false,
      },
    });
  });

  it("returns processor errors without calling the real SumUp helper", async () => {
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "blocked",
      status: 409,
      error: "A SumUp refund attempt is already processing. No SumUp refund was sent.",
      attemptId: 900,
      attemptStatus: "processing",
    });

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("A SumUp refund attempt is already processing. No SumUp refund was sent.");
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("returns a safe diagnostic code for rejected SumUp refunds", async () => {
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_failed",
      status: 502,
      error: "SumUp rejected the refund. No wallet debit was created.",
      diagnosticCode: "sumup_refund_403_request_not_allowed",
      attemptId: 900,
      refundRequestId: 501,
    });

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "SumUp rejected the refund. No wallet debit was created.",
      diagnostic_code: "sumup_refund_403_request_not_allowed",
      outcome: "sumup_failed",
      sumup_refund_attempt: {
        id: 900,
        status: "failed",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Bearer");
    expect(JSON.stringify(body)).not.toContain("transaction-id");
    expect(JSON.stringify(body)).not.toContain("MERCHANT");
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("does not enable the automatic path unless the explicit TEST mock guard is active", async () => {
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Automatic SumUp refunds are not enabled in this environment.",
    });
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(completeWalletRefundRequestMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects real mode on the TEST Supabase project", async () => {
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects real mode when TEST mock flags exist", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";
    process.env.E2E_MOCK_SUMUP_REFUNDS = "true";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects real mode when the sandbox refund flag exists", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects real mode without the explicit real refund enable flag", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.E2E_ALLOW_DB_MUTATION;
    delete process.env.E2E_MOCK_SUMUP_REFUNDS;
    delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
    delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
    process.env.SUMUP_API_KEY = "sumup-key";
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("selects the real refund dependency behind the local sandbox real gate", async () => {
    enableLocalSandboxRealRefundMode();

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      actorUserId: "admin-1",
      initiatedBy: "admin",
      refundDependency: expect.any(Function),
    });
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects local sandbox real mode on the production Supabase project", async () => {
    enableLocalSandboxRealRefundMode();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects local sandbox real mode in production runtime contexts", async () => {
    enableLocalSandboxRealRefundMode();
    vi.stubEnv("NODE_ENV", "production");

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects local sandbox real mode in Vercel production contexts", async () => {
    enableLocalSandboxRealRefundMode();
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects local sandbox real mode when real refunds are enabled", async () => {
    enableLocalSandboxRealRefundMode();
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects local sandbox real mode without the sandbox merchant code", async () => {
    enableLocalSandboxRealRefundMode();
    process.env.SUMUP_MERCHANT_CODE = "merchant-1";

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(403);
    expect(processAutomaticSumUpRefundMock).not.toHaveBeenCalled();
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("selects the real refund dependency only behind the production real gate", async () => {
    enableProductionRealRefundMode();

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(processAutomaticSumUpRefundMock).toHaveBeenCalledWith({
      refundRequestId: 501,
      actorUserId: "admin-1",
      initiatedBy: "admin",
      refundDependency: expect.any(Function),
    });
    expect(refundSumUpTransactionMock).not.toHaveBeenCalled();
  });

  it("classifies real SumUp HTTP rejection as failed through the production dependency", async () => {
    enableProductionRealRefundMode();
    refundSumUpTransactionMock.mockRejectedValueOnce(
      new SumUpRefundHttpError("Refund amount is too high.", 422, {
        detail: "Refund amount is too high.",
      })
    );

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    const dependency = processAutomaticSumUpRefundMock.mock.calls[0]?.[0]
      .refundDependency;
    const result = await dependency({
      transactionId: "transaction-id-1",
      amount: 99,
      originalPaymentAmount: 100,
      currency: "GBP",
    });

    expect(refundSumUpTransactionMock).toHaveBeenCalledWith({
      transactionId: "transaction-id-1",
      amount: 99,
      originalPaymentAmount: 100,
    });

    expect(result).toEqual({
      outcome: "failed",
      errorMessage: "Refund amount is too high.",
      response: {
        detail: "Refund amount is too high.",
      },
    });
  });

  it.each([429, 500, 502, 503, 504])(
    "classifies real SumUp HTTP %s as unknown through the production dependency",
    async (status) => {
      enableProductionRealRefundMode();
      refundSumUpTransactionMock.mockRejectedValueOnce(
        new SumUpRefundHttpError(`SumUp HTTP ${status}.`, status, {
          http_status: status,
          message: `SumUp HTTP ${status}.`,
        })
      );

      const response = await PATCH(
        requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
        routeContext()
      );

      expect(response.status).toBe(200);
      const dependency = processAutomaticSumUpRefundMock.mock.calls[0]?.[0]
        .refundDependency;
      const result = await dependency({
        transactionId: "transaction-id-1",
        amount: 99,
        originalPaymentAmount: 100,
        currency: "GBP",
      });

      expect(result).toEqual({
        outcome: "unknown",
        errorMessage: `SumUp HTTP ${status}.`,
        response: {
          http_status: status,
          message: `SumUp HTTP ${status}.`,
        },
      });
    }
  );

  it("classifies uncertain HTTP 409 as unknown through the production dependency", async () => {
    enableProductionRealRefundMode();
    refundSumUpTransactionMock.mockRejectedValueOnce(
      new SumUpRefundHttpError("Conflict.", 409, {
        http_status: 409,
        message: "Conflict.",
      })
    );

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    const dependency = processAutomaticSumUpRefundMock.mock.calls[0]?.[0]
      .refundDependency;
    const result = await dependency({
      transactionId: "transaction-id-1",
      amount: 99,
      originalPaymentAmount: 100,
      currency: "GBP",
    });

    expect(result).toEqual({
      outcome: "unknown",
      errorMessage: "Conflict.",
      response: {
        http_status: 409,
        message: "Conflict.",
      },
    });
  });

  it("classifies real SumUp transport errors as unknown through the production dependency", async () => {
    enableProductionRealRefundMode();
    refundSumUpTransactionMock.mockRejectedValueOnce(new Error("fetch failed"));

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );

    expect(response.status).toBe(200);
    const dependency = processAutomaticSumUpRefundMock.mock.calls[0]?.[0]
      .refundDependency;
    const result = await dependency({
      transactionId: "transaction-id-1",
      amount: 99,
      originalPaymentAmount: 100,
      currency: "GBP",
    });

    expect(result).toEqual({
      outcome: "unknown",
      errorMessage: "fetch failed",
      response: null,
    });
  });

  it.each(["network timeout", "connection reset"])(
    "classifies real SumUp %s as unknown through the production dependency",
    async (message) => {
      enableProductionRealRefundMode();
      refundSumUpTransactionMock.mockRejectedValueOnce(new Error(message));

      const response = await PATCH(
        requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
        routeContext()
      );

      expect(response.status).toBe(200);
      const dependency = processAutomaticSumUpRefundMock.mock.calls[0]?.[0]
        .refundDependency;
      const result = await dependency({
        transactionId: "transaction-id-1",
        amount: 99,
        originalPaymentAmount: 100,
        currency: "GBP",
      });

      expect(result).toEqual({
        outcome: "unknown",
        errorMessage: message,
        response: null,
      });
    }
  );

  it("surfaces unknown SumUp attempts as manual-review results", async () => {
    processAutomaticSumUpRefundMock.mockResolvedValue({
      outcome: "sumup_unknown",
      status: 502,
      error: "SumUp refund outcome is unknown. Reconcile manually before retrying.",
      attemptId: 900,
      refundRequestId: 501,
    });

    const response = await PATCH(
      requestBody("refund_via_sumup") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "SumUp refund outcome is unknown. Reconcile manually before retrying.",
      outcome: "sumup_unknown",
      sumup_refund_attempt: {
        id: 900,
        status: "unknown",
      },
    });
  });

  it("does not double debit a duplicate approval after the request is completed", async () => {
    const firstResponse = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const secondResponse = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(404);
    expect(secondBody.error).toBe("Pending refund request not found.");
    expect(completeWalletRefundRequestMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the request pending when wallet balance is insufficient", async () => {
    completeWalletRefundRequestMock.mockResolvedValue({
      success: false,
      refundRequestId: 501,
      refundTransactionId: null,
      reason: "insufficient_balance",
      completedBalance: 8,
      reservedRefundAmount: 8,
      availableBalance: 0,
    });

    const response = await PATCH(
      requestBody("approve", "Paid manually") as Parameters<typeof PATCH>[0],
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Insufficient wallet balance for this refund.");
    expect(state.refundRequest).toMatchObject({
      status: "pending",
      admin_note: null,
    });
  });
});
