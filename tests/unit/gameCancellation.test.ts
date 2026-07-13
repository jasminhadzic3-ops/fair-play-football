import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRpcMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() => vi.fn());
const sendGameCancelledEmailsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: supabaseRpcMock,
    from: supabaseFromMock,
  },
}));

vi.mock("@/lib/email/gameCancelled", () => ({
  sendGameCancelledEmails: sendGameCancelledEmailsMock,
}));

import {
  cancelGameWithWalletCredits,
  retryGameCancellationEmails,
} from "@/lib/gameCancellation";

type GameRow = {
  id: number;
  title: string | null;
  status: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

const cancelledGame: GameRow = {
  id: 10,
  title: "Friday Football",
  status: "cancelled",
  cancelled_at: "2026-07-13T10:00:00.000Z",
  cancelled_by: "admin-1",
  cancellation_reason: "Weather",
};

const activeGame: GameRow = {
  ...cancelledGame,
  status: "active",
  cancelled_at: null,
  cancelled_by: null,
  cancellation_reason: null,
};

function rpcResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    game_id: 10,
    already_cancelled: false,
    sumup_credited_count: 1,
    wallet_credited_count: 1,
    total_credited_count: 2,
    waiting_list_removed_count: 3,
    affected_user_ids: ["user-1", "user-2"],
    email_should_send: true,
    reason: null,
    ...overrides,
  };
}

function mockGame(game: GameRow | null = cancelledGame) {
  supabaseFromMock.mockImplementation((table: string) => {
    if (table !== "games") {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: game, error: null }),
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseRpcMock.mockResolvedValue({ data: [rpcResult()], error: null });
  sendGameCancelledEmailsMock.mockResolvedValue({ skipped: false, sentCount: 2 });
  mockGame();
});

describe("cancelGameWithWalletCredits", () => {
  it("calls the atomic cancellation RPC and sends emails only after success", async () => {
    const result = await cancelGameWithWalletCredits({
      gameId: 10,
      adminUserId: "admin-1",
      cancellationReason: " Weather ",
    });

    expect(supabaseRpcMock).toHaveBeenCalledWith("cancel_game_with_wallet_credits", {
      p_game_id: 10,
      p_admin_user_id: "admin-1",
      p_cancellation_reason: "Weather",
    });
    expect(result).toMatchObject({
      sumup_credited_count: 1,
      wallet_credited_count: 1,
      total_credited_count: 2,
      waiting_list_removed_count: 3,
      affected_user_ids: ["user-1", "user-2"],
    });
    expect(sendGameCancelledEmailsMock).toHaveBeenCalledWith({ gameId: 10 });
  });

  it("does not send emails or create side effects when the RPC reports already cancelled", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [
        rpcResult({
          already_cancelled: true,
          sumup_credited_count: 0,
          wallet_credited_count: 0,
          total_credited_count: 0,
          waiting_list_removed_count: 0,
          email_should_send: false,
        }),
      ],
      error: null,
    });

    const result = await cancelGameWithWalletCredits({
      gameId: 10,
      adminUserId: "admin-1",
      cancellationReason: null,
    });

    expect(result.already_cancelled).toBe(true);
    expect(result.total_credited_count).toBe(0);
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("reports email failures without failing the committed cancellation", async () => {
    sendGameCancelledEmailsMock.mockRejectedValue(new Error("resend down"));

    const result = await cancelGameWithWalletCredits({
      gameId: 10,
      adminUserId: "admin-1",
      cancellationReason: "Weather",
    });

    expect(result.total_credited_count).toBe(2);
    expect(result.email_warning).toBe("resend down");
  });

  it("propagates RPC validation errors before email sending", async () => {
    supabaseRpcMock.mockResolvedValue({
      data: [rpcResult({ success: false, reason: "game_not_found" })],
      error: null,
    });

    await expect(
      cancelGameWithWalletCredits({
        gameId: 10,
        adminUserId: "admin-1",
        cancellationReason: "Weather",
      })
    ).rejects.toMatchObject({
      name: "GameCancellationError",
      status: 404,
    });
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });

  it("does not perform wallet credit writes outside the RPC", async () => {
    await cancelGameWithWalletCredits({
      gameId: 10,
      adminUserId: "admin-1",
      cancellationReason: "Weather",
    });

    expect(supabaseRpcMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock.mock.calls[0][0]).toBe("cancel_game_with_wallet_credits");
  });
});

describe("retryGameCancellationEmails", () => {
  it("resends cancellation emails for an already-cancelled game without calling the RPC", async () => {
    const warning = await retryGameCancellationEmails({ gameId: 10 });

    expect(warning).toBeUndefined();
    expect(supabaseRpcMock).not.toHaveBeenCalled();
    expect(sendGameCancelledEmailsMock).toHaveBeenCalledWith({ gameId: 10 });
  });

  it("rejects email retry for an active game", async () => {
    mockGame(activeGame);

    await expect(retryGameCancellationEmails({ gameId: 10 })).rejects.toMatchObject({
      name: "GameCancellationError",
      status: 409,
    });
    expect(sendGameCancelledEmailsMock).not.toHaveBeenCalled();
  });
});
