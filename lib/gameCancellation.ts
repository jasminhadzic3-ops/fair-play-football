import "server-only";

import { sendGameCancelledEmails } from "@/lib/email/gameCancelled";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CancelGameParams = {
  gameId: number;
  adminUserId: string;
  cancellationReason?: string | null;
};

type RetryGameCancellationEmailsParams = {
  gameId: number;
};

type GameCancellationRpcResult = {
  success: boolean;
  game_id: number | null;
  already_cancelled: boolean | null;
  sumup_credited_count: number | null;
  wallet_credited_count: number | null;
  total_credited_count: number | null;
  waiting_list_removed_count: number | null;
  affected_user_ids: string[] | null;
  email_should_send: boolean | null;
  reason: string | null;
};

type GameRow = {
  id: number;
  title: string | null;
  status: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

type GameCancelledEmailResult = Awaited<ReturnType<typeof sendGameCancelledEmails>>;

export type CancelGameResult = {
  game: GameRow;
  sumup_credited_count: number;
  wallet_credited_count: number;
  total_credited_count: number;
  waiting_list_removed_count: number;
  affected_user_ids: string[];
  already_cancelled?: boolean;
  email_warning?: string;
};

export class GameCancellationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "GameCancellationError";
    this.status = status;
  }
}

function normalizeReason(reason: string | null | undefined) {
  const trimmedReason = reason?.trim();

  return trimmedReason || null;
}

function getStatusForRpcReason(reason: string | null) {
  switch (reason) {
    case "invalid_game":
    case "invalid_admin_user":
      return 400;
    case "game_not_found":
      return 404;
    default:
      return 500;
  }
}

async function loadGame(gameId: number) {
  const { data: game, error } = await supabaseAdmin
    .from("games")
    .select("*")
    .eq("id", gameId)
    .maybeSingle<GameRow>();

  if (error) {
    throw error;
  }

  if (!game) {
    throw new GameCancellationError("Game not found.", 404);
  }

  return game;
}

async function sendCancellationEmails(gameId: number) {
  try {
    const result = (await sendGameCancelledEmails({ gameId })) as GameCancelledEmailResult;

    if (result.skipped) {
      return "Game cancellation emails were skipped. Check EMAIL_ENABLE_GAME_CANCELLED is set to true.";
    }

    if (result.sentCount === 0) {
      return "Game cancellation emails were not sent because no email recipients were found.";
    }

    return undefined;
  } catch (error) {
    console.error("Unable to send game cancellation emails:", error);
    return error instanceof Error ? error.message : "Unable to send game cancellation emails.";
  }
}

function normalizeRpcResult(result: GameCancellationRpcResult, game: GameRow): CancelGameResult {
  return {
    game,
    sumup_credited_count: Number(result.sumup_credited_count ?? 0),
    wallet_credited_count: Number(result.wallet_credited_count ?? 0),
    total_credited_count: Number(result.total_credited_count ?? 0),
    waiting_list_removed_count: Number(result.waiting_list_removed_count ?? 0),
    affected_user_ids: result.affected_user_ids ?? [],
    ...(result.already_cancelled ? { already_cancelled: true } : {}),
  };
}

export async function cancelGameWithWalletCredits({
  gameId,
  adminUserId,
  cancellationReason,
}: CancelGameParams): Promise<CancelGameResult> {
  const reason = normalizeReason(cancellationReason);
  const { data, error } = await supabaseAdmin.rpc("cancel_game_with_wallet_credits", {
    p_game_id: gameId,
    p_admin_user_id: adminUserId,
    p_cancellation_reason: reason,
  });

  if (error) {
    throw error;
  }

  const rpcResult = (Array.isArray(data) ? data[0] : data) as GameCancellationRpcResult | null;

  if (!rpcResult) {
    throw new GameCancellationError("Game cancellation did not return a result.");
  }

  if (!rpcResult.success) {
    throw new GameCancellationError(
      `Unable to cancel game: ${rpcResult.reason || "unknown_reason"}.`,
      getStatusForRpcReason(rpcResult.reason)
    );
  }

  const game = await loadGame(gameId);
  const result = normalizeRpcResult(rpcResult, game);

  if (rpcResult.email_should_send) {
    const emailWarning = await sendCancellationEmails(gameId);

    if (emailWarning) {
      return {
        ...result,
        email_warning: emailWarning,
      };
    }
  }

  return result;
}

export async function retryGameCancellationEmails({
  gameId,
}: RetryGameCancellationEmailsParams) {
  const game = await loadGame(gameId);

  if (game.status !== "cancelled") {
    throw new GameCancellationError("Game must be cancelled before cancellation emails can be sent.", 409);
  }

  return sendCancellationEmails(gameId);
}
