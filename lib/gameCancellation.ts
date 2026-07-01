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

type CurrentBookingRow = {
  id: number;
  user_id: string;
  player_name: string | null;
};

type SumUpCreditPlan = {
  type: "sumup";
  booking: CurrentBookingRow;
  payment: SumUpPaymentRow;
  amount: number;
};

type WalletCreditPlan = {
  type: "wallet";
  booking: CurrentBookingRow;
  walletTransaction: WalletBookingPaymentRow;
  amount: number;
};

type CancellationCreditPlan = SumUpCreditPlan | WalletCreditPlan;
type GameCancelledEmailResult = Awaited<ReturnType<typeof sendGameCancelledEmails>>;

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

function createReconciliationError(message: string) {
  return new GameCancellationError(message, 409);
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

async function loadCurrentAffectedBookings(gameId: number) {
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id,user_id,player_name")
    .eq("game_id", gameId)
    .not("user_id", "is", null)
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return (bookings ?? []) as CurrentBookingRow[];
}

function addGroupedRow<T extends { booking_id: number | null }>(
  groupedRows: Map<number, T[]>,
  row: T
) {
  if (!row.booking_id) {
    return;
  }

  const rows = groupedRows.get(row.booking_id) ?? [];
  rows.push(row);
  groupedRows.set(row.booking_id, rows);
}

async function loadValidSumUpPaymentsByBooking(bookingsById: Map<number, CurrentBookingRow>) {
  const bookingIds = Array.from(bookingsById.keys());
  const paymentsByBookingId = new Map<number, SumUpPaymentRow[]>();

  if (bookingIds.length === 0) {
    return paymentsByBookingId;
  }

  const { data: payments, error } = await supabaseAdmin
    .from("booking_payments")
    .select("id,user_id,booking_id,amount,currency")
    .in("booking_id", bookingIds)
    .eq("payment_status", "paid")
    .gt("amount", 0)
    .not("user_id", "is", null);

  if (error) {
    throw error;
  }

  for (const payment of (payments ?? []) as SumUpPaymentRow[]) {
    const booking = payment.booking_id ? bookingsById.get(payment.booking_id) : null;

    if (!booking) {
      continue;
    }

    if (!payment.user_id || payment.user_id !== booking.user_id) {
      throw createReconciliationError(
        `Booking ${booking.id} has a SumUp payment with mismatched user details and must be reconciled before cancellation.`
      );
    }

    parsePositiveMoneyAmount(payment.amount, `payment ${payment.id}`);
    addGroupedRow(paymentsByBookingId, payment);
  }

  return paymentsByBookingId;
}

async function loadValidWalletDebitsByBooking(bookingsById: Map<number, CurrentBookingRow>) {
  const bookingIds = Array.from(bookingsById.keys());
  const walletDebitsByBookingId = new Map<number, WalletBookingPaymentRow[]>();

  if (bookingIds.length === 0) {
    return walletDebitsByBookingId;
  }

  const { data: walletTransactions, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,user_id,booking_id,amount,currency")
    .in("booking_id", bookingIds)
    .eq("transaction_type", "wallet_booking_payment")
    .eq("status", "completed")
    .lt("amount", 0)
    .not("user_id", "is", null);

  if (error) {
    throw error;
  }

  for (const walletTransaction of (walletTransactions ?? []) as WalletBookingPaymentRow[]) {
    const booking = walletTransaction.booking_id ? bookingsById.get(walletTransaction.booking_id) : null;

    if (!booking) {
      continue;
    }

    if (!walletTransaction.user_id || walletTransaction.user_id !== booking.user_id) {
      throw createReconciliationError(
        `Booking ${booking.id} has a wallet transaction with mismatched user details and must be reconciled before cancellation.`
      );
    }

    parsePositiveMoneyAmount(
      Math.abs(Number(walletTransaction.amount)),
      `wallet transaction ${walletTransaction.id}`
    );
    addGroupedRow(walletDebitsByBookingId, walletTransaction);
  }

  return walletDebitsByBookingId;
}

async function buildCancellationCreditPlan(gameId: number) {
  const currentBookings = await loadCurrentAffectedBookings(gameId);
  const bookingsById = new Map(currentBookings.map((booking) => [booking.id, booking]));
  const [sumUpPaymentsByBookingId, walletDebitsByBookingId] = await Promise.all([
    loadValidSumUpPaymentsByBooking(bookingsById),
    loadValidWalletDebitsByBooking(bookingsById),
  ]);
  const creditPlan: CancellationCreditPlan[] = [];

  for (const booking of currentBookings) {
    const sumUpPayments = sumUpPaymentsByBookingId.get(booking.id) ?? [];
    const walletDebits = walletDebitsByBookingId.get(booking.id) ?? [];

    if (sumUpPayments.length > 1) {
      throw createReconciliationError(
        `Booking ${booking.id} has multiple paid SumUp payment records and must be reconciled before cancellation.`
      );
    }

    if (walletDebits.length > 1) {
      throw createReconciliationError(
        `Booking ${booking.id} has multiple wallet booking payment records and must be reconciled before cancellation.`
      );
    }

    if (sumUpPayments.length === 1 && walletDebits.length === 1) {
      throw createReconciliationError(
        `Booking ${booking.id} has both SumUp and wallet payment records and must be reconciled before cancellation.`
      );
    }

    const [sumUpPayment] = sumUpPayments;
    const [walletDebit] = walletDebits;

    if (sumUpPayment) {
      creditPlan.push({
        type: "sumup",
        booking,
        payment: sumUpPayment,
        amount: parsePositiveMoneyAmount(sumUpPayment.amount, `payment ${sumUpPayment.id}`),
      });
    }

    if (walletDebit) {
      creditPlan.push({
        type: "wallet",
        booking,
        walletTransaction: walletDebit,
        amount: parsePositiveMoneyAmount(
          Math.abs(Number(walletDebit.amount)),
          `wallet transaction ${walletDebit.id}`
        ),
      });
    }
  }

  return creditPlan;
}

async function createCancellationCredits(params: {
  game: GameRow;
  adminUserId: string;
  cancellationReason: string | null;
}) {
  const creditPlan = await buildCancellationCreditPlan(params.game.id);
  let sumupCreditedCount = 0;
  let walletCreditedCount = 0;

  for (const credit of creditPlan) {
    if (credit.type === "sumup") {
      await creditWallet({
        userId: credit.booking.user_id,
        amount: credit.amount,
        currency: credit.payment.currency ?? "GBP",
        transactionType: "game_cancelled_credit",
        gameId: params.game.id,
        bookingId: credit.booking.id,
        paymentId: credit.payment.id,
        idempotencyKey: `game_cancelled_credit:game:${params.game.id}:payment:${credit.payment.id}`,
        description: `Credit for cancelled game: ${params.game.title || "Football match"}`,
        adminNote: params.cancellationReason,
        metadata: {
          original_payment_method: "sumup",
          cancelled_by: params.adminUserId,
        },
      });
      sumupCreditedCount += 1;
      continue;
    }

    await creditWallet({
      userId: credit.booking.user_id,
      amount: credit.amount,
      currency: credit.walletTransaction.currency ?? "GBP",
      transactionType: "game_cancelled_credit",
      gameId: params.game.id,
      bookingId: credit.booking.id,
      idempotencyKey: `game_cancelled_credit:game:${params.game.id}:wallet_transaction:${credit.walletTransaction.id}`,
      description: `Credit for cancelled game: ${params.game.title || "Football match"}`,
      adminNote: params.cancellationReason,
      metadata: {
        original_payment_method: "wallet",
        original_wallet_transaction_id: credit.walletTransaction.id,
        cancelled_by: params.adminUserId,
      },
    });
    walletCreditedCount += 1;
  }

  return {
    sumupCreditedCount,
    walletCreditedCount,
  };
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

  const { sumupCreditedCount, walletCreditedCount } = await createCancellationCredits({
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
