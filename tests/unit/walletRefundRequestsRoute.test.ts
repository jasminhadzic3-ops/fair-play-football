import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn());
const createWalletRefundRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sumupPayments", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/wallet", () => ({
  createWalletRefundRequest: createWalletRefundRequestMock,
}));

import { POST } from "@/app/api/wallet/refund-requests/route";

function refundRequest(sourceWalletTransactionId: number | null = 900) {
  return new Request("http://localhost/api/wallet/refund-requests", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source_wallet_transaction_id: sourceWalletTransactionId }),
  });
}

function successfulRefundRequest(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    refundRequestId: 123,
    reason: null,
    alreadyExists: false,
    completedBalance: 12,
    reservedRefundAmount: 8,
    availableBalance: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({
    id: "user-1",
    email: "player@example.com",
  });
  createWalletRefundRequestMock.mockResolvedValue(successfulRefundRequest());
});

describe("wallet refund request route", () => {
  it("returns 401 when the user is signed out", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
  });

  it("requires a source wallet transaction id", async () => {
    const response = await POST(refundRequest(null) as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Please choose a refundable wallet credit.");
    expect(createWalletRefundRequestMock).not.toHaveBeenCalled();
  });

  it("delegates atomic refund reservation to the wallet helper", async () => {
    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createWalletRefundRequestMock).toHaveBeenCalledWith({
      userId: "user-1",
      sourceWalletTransactionId: 900,
    });
    expect(body).toMatchObject({
      refund_request: {
        id: 123,
        status: "pending",
      },
      already_exists: false,
      balance: 4,
      balance_breakdown: {
        completedBalance: 12,
        reservedRefundAmount: 8,
        availableBalance: 4,
      },
    });
  });

  it("returns an existing active request without treating it as an error", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        refundRequestId: 55,
        alreadyExists: true,
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      refund_request: {
        id: 55,
        status: "existing",
      },
      already_exists: true,
    });
  });

  it("maps missing or unowned source credits to 404", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "source_credit_not_owned",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Refundable wallet credit not found.");
  });

  it("rejects non-SumUp cancellation credits", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "not_sumup_cancellation_credit",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only SumUp cancellation credits can be requested for card refund.");
  });

  it("rejects refund requests over available balance", async () => {
    createWalletRefundRequestMock.mockResolvedValue(
      successfulRefundRequest({
        success: false,
        refundRequestId: null,
        reason: "insufficient_balance",
      })
    );

    const response = await POST(refundRequest() as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Refund amount cannot be greater than your wallet balance.");
  });
});
