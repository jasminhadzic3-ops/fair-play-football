import "server-only";

import { sendGameCancelledEmails } from "@/lib/email/gameCancelled";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { creditWallet } from "@/lib/wallet";

type CancelGameParams = {
  gameId: number;
  adminUserId: string;
  cancellationReason?: string | null;
};

type GameRow = {
  id: number;
  title: string | null;
  status: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

type SumUpPaymentRow = {
  id: number;
  user_id: string | null;
  booking_id: number | null;
  amount: number | string | null;
  currency: string | null;
};

type WalletBookingPaymentRow = {
  id: number;
  user_id: string | null;
  booking_id: number | null;
  amount: number | string | null;
  currency: string | null;
};

export type CancelGameResult = {
  game: GameRow;
  sumup_credited_count: number;
  wallet_credited_count: number;
  total_credited_count: number;
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

function parsePositiveMoneyAmount(value: number | string | null, context: string) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new GameCancellationError(`Invalid credit amount for ${context}.`);
  }

  return amount;
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

async function creditSumUpPayments(params: {
  game: GameRow;
  adminUserId: string;
  cancellationReason: string | null;
}) {
  const { data: payments, error } = await supabaseAdmin
    .from("booking_payments")
    .select("id,user_id,booking_id,amount,currency")
    .eq("game_id", params.game.id)
    .eq("payment_status", "paid")
    .gt("amount", 0)
    .not("user_id", "is", null);

  if (error) {
    throw error;
  }

  for (const payment of (payments ?? []) as SumUpPaymentRow[]) {
    if (!payment.user_id) {
      throw new GameCancellationError(`Paid payment ${payment.id} has no user_id.`);
    }

    const amount = parsePositiveMoneyAmount(payment.amount, `payment ${payment.id}`);

    await creditWallet({
      userId: payment.user_id,
      amount,
      currency: payment.currency ?? "GBP",
      transactionType: "game_cancelled_credit",
      gameId: params.game.id,
      bookingId: payment.booking_id ?? null,
      paymentId: payment.id,
      idempotencyKey: `game_cancelled_credit:game:${params.game.id}:payment:${payment.id}`,
      description: `Credit for cancelled game: ${params.game.title || "Football match"}`,
      adminNote: params.cancellationReason,
      metadata: {
        original_payment_method: "sumup",
        cancelled_by: params.adminUserId,
      },
    });
  }

  return (payments ?? []).length;
}

async function restoreWalletBookingPayments(params: {
  game: GameRow;
  adminUserId: string;
  cancellationReason: string | null;
}) {
  const { data: walletTransactions, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,user_id,booking_id,amount,currency")
    .eq("game_id", params.game.id)
    .eq("transaction_type", "wallet_booking_payment")
    .eq("status", "completed")
    .lt("amount", 0)
    .not("user_id", "is", null);

  if (error) {
    throw error;
  }

  for (const walletTransaction of (walletTransactions ?? []) as WalletBookingPaymentRow[]) {
    if (!walletTransaction.user_id) {
      throw new GameCancellationError(`Wallet booking transaction ${walletTransaction.id} has no user_id.`);
    }

    const amount = parsePositiveMoneyAmount(
      Math.abs(Number(walletTransaction.amount)),
      `wallet transaction ${walletTransaction.id}`
    );

    await creditWallet({
      userId: walletTransaction.user_id,
      amount,
      currency: walletTransaction.currency ?? "GBP",
      transactionType: "game_cancelled_credit",
      gameId: params.game.id,
      bookingId: walletTransaction.booking_id ?? null,
      idempotencyKey: `game_cancelled_credit:game:${params.game.id}:wallet_transaction:${walletTransaction.id}`,
      description: `Credit for cancelled game: ${params.game.title || "Football match"}`,
      adminNote: params.cancellationReason,
      metadata: {
        original_payment_method: "wallet",
        original_wallet_transaction_id: walletTransaction.id,
        cancelled_by: params.adminUserId,
      },
    });
  }

  return (walletTransactions ?? []).length;
}

async function markGameCancelled(params: {
  gameId: number;
  adminUserId: string;
  cancellationReason: string | null;
}) {
  const { data: updatedGame, error } = await supabaseAdmin
    .from("games")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: params.adminUserId,
      cancellation_reason: params.cancellationReason,
    })
    .eq("id", params.gameId)
    .neq("status", "cancelled")
    .select("*")
    .maybeSingle<GameRow>();

  if (error) {
    throw error;
  }

  return updatedGame ?? loadGame(params.gameId);
}

async function sendCancellationEmails(gameId: number) {
  try {
    await sendGameCancelledEmails({ gameId });
    return undefined;
  } catch (error) {
    console.error("Unable to send game cancellation emails:", error);
    return error instanceof Error ? error.message : "Unable to send game cancellation emails.";
  }
}

export async function cancelGameWithWalletCredits({
  gameId,
  adminUserId,
  cancellationReason,
}: CancelGameParams): Promise<CancelGameResult> {
  const reason = normalizeReason(cancellationReason);
  const game = await loadGame(gameId);

  if (game.status === "cancelled") {
    return {
      game,
      sumup_credited_count: 0,
      wallet_credited_count: 0,
      total_credited_count: 0,
      already_cancelled: true,
    };
  }

  const sumupCreditedCount = await creditSumUpPayments({
    game,
    adminUserId,
    cancellationReason: reason,
  });
  const walletCreditedCount = await restoreWalletBookingPayments({
    game,
    adminUserId,
    cancellationReason: reason,
  });
  const updatedGame = await markGameCancelled({
    gameId,
    adminUserId,
    cancellationReason: reason,
  });
  const emailWarning = await sendCancellationEmails(gameId);

  return {
    game: updatedGame,
    sumup_credited_count: sumupCreditedCount,
    wallet_credited_count: walletCreditedCount,
    total_credited_count: sumupCreditedCount + walletCreditedCount,
    ...(emailWarning ? { email_warning: emailWarning } : {}),
  };
}
