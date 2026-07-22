import { NextRequest } from "next/server";
import { buildAdminFinancialRecordsByGame } from "@/lib/adminFinancialRecords";
import { buildAdminGameSafetySummary } from "@/lib/adminGameSafety";
import { buildAdminRefundCandidates } from "@/lib/adminRefundCandidates";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAutomaticSumUpRefundCapabilities } from "@/lib/sumupRefundCapabilities";

type Payment = {
  id: number;
  user_id?: string | null;
  game_id?: number | null;
  booking_id?: number | null;
  player_name?: string | null;
  payment_status: string | null;
  amount: number | string | null;
  currency?: string | null;
  transaction_code?: string | null;
  sumup_transaction_id?: string | null;
  created_at?: string | null;
};

type Game = {
  id: number;
  title: string | null;
  max_players?: number | null;
  status?: string | null;
  archived_at?: string | null;
};

type Booking = {
  id: number;
  game_id?: number | null;
  user_id?: string | null;
  player_name: string | null;
};

type Profile = {
  id: string;
  email: string | null;
  username: string | null;
};

type RefundRequest = {
  id: number;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  description: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string | null;
};

type SumUpRefundAttempt = {
  id: number;
  refund_request_id: number;
  booking_payment_id?: number | null;
  status: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type WalletSummaryTransaction = {
  id: number;
  user_id?: string | null;
  game_id: number | null;
  booking_id?: number | null;
  payment_id?: number | null;
  amount: number | string | null;
  currency?: string | null;
  transaction_type: string | null;
  status: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type ReminderDelivery = {
  id: number;
  game_id: number | null;
  booking_id?: number | null;
  user_id?: string | null;
  status?: string | null;
  attempts?: number | null;
  created_at?: string | null;
};

type WaitingListSummaryEntry = {
  id: number;
  game_id: number | null;
  user_id?: string | null;
  player_name?: string | null;
  status?: string | null;
  created_at?: string | null;
};

function countPaymentsByStatus(payments: Payment[]) {
  return payments.reduce<Record<string, number>>((counts, payment) => {
    const status = payment.payment_status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function countUniquePlayers(bookings: Array<{ user_id: string | null; player_name: string | null }>) {
  const playerKeys = new Set<string>();

  bookings.forEach((booking) => {
    const key = booking.user_id || booking.player_name?.trim().toLowerCase();

    if (key) {
      playerKeys.add(key);
    }
  });

  return playerKeys.size;
}

function sumPaidPaymentAmounts(payments: Payment[]) {
  return payments
    .filter((payment) => payment.payment_status?.toLowerCase() === "paid")
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function increment(map: Map<number, number>, gameId: number | null | undefined) {
  if (!gameId) {
    return;
  }

  map.set(gameId, (map.get(gameId) ?? 0) + 1);
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [
      gamesResult,
      bookingsResult,
      profilesResult,
      paymentsResult,
      walletTransactionsResult,
      refundRequestsResult,
      sumUpRefundAttemptsResult,
      waitingListResult,
      walletSummaryTransactionsResult,
      reminderDeliveriesResult,
      waitingListSummaryResult,
      waitingListNotificationsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id,title,location,time,starts_at,price,max_players,status,cancelled_at,cancelled_by,cancellation_reason,archived_at,archived_by")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("bookings")
        .select("id,game_id,user_id,player_name")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("profiles")
        .select("id,email,username,age,gender,favourite_position"),
      supabaseAdmin
        .from("booking_payments")
        .select(
          "id,user_id,game_id,player_name,payment_status,booking_id,amount,currency,transaction_code,sumup_transaction_id,created_at,updated_at"
        )
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,user_id,game_id,booking_id,amount,currency,transaction_type,status,created_at")
        .eq("transaction_type", "wallet_booking_payment")
        .eq("status", "completed")
        .lt("amount", 0)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,user_id,amount,currency,transaction_type,status,description,metadata,created_at")
        .eq("transaction_type", "refund_requested")
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("sumup_refund_attempts")
        .select("id,refund_request_id,booking_payment_id,status,error_message,created_at,updated_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("waiting_list")
        .select("id,game_id,user_id,player_name,status,created_at")
        .eq("status", "waiting")
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,user_id,game_id,booking_id,payment_id,amount,currency,transaction_type,status,metadata,created_at"),
      supabaseAdmin
        .from("game_reminder_deliveries")
        .select("id,game_id,booking_id,user_id,status,attempts,created_at"),
      supabaseAdmin
        .from("waiting_list")
        .select("id,game_id,user_id,player_name,status,created_at"),
      supabaseAdmin
        .from("waiting_list_notifications")
        .select("id,game_id,user_id,player_name,status,created_at"),
    ]);

    const firstError =
      gamesResult.error ||
      bookingsResult.error ||
      profilesResult.error ||
      paymentsResult.error ||
      walletTransactionsResult.error ||
      refundRequestsResult.error ||
      sumUpRefundAttemptsResult.error ||
      waitingListResult.error ||
      walletSummaryTransactionsResult.error ||
      reminderDeliveriesResult.error ||
      waitingListSummaryResult.error ||
      waitingListNotificationsResult.error;

    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    const games = gamesResult.data ?? [];
    const bookings = bookingsResult.data ?? [];
    const profiles = profilesResult.data ?? [];
    const bookingPayments = paymentsResult.data ?? [];
    const safeBookingPayments = (bookingPayments as Payment[]).map((payment) => ({
      id: payment.id,
      user_id: payment.user_id ?? null,
      game_id: payment.game_id ?? null,
      player_name: payment.player_name ?? null,
      payment_status: payment.payment_status ?? null,
      booking_id: payment.booking_id ?? null,
      amount: payment.amount ?? null,
      currency: payment.currency ?? null,
      created_at: payment.created_at ?? null,
    }));
    const walletTransactions = walletTransactionsResult.data ?? [];
    const walletSummaryTransactions = (walletSummaryTransactionsResult.data ?? []) as WalletSummaryTransaction[];
    const reminderDeliveries = (reminderDeliveriesResult.data ?? []) as ReminderDelivery[];
    const waitingListSummary = (waitingListSummaryResult.data ?? []) as WaitingListSummaryEntry[];
    const waitingListNotifications = (waitingListNotificationsResult.data ?? []) as WaitingListSummaryEntry[];
    const profileById = new Map((profiles as Profile[]).map((profile) => [profile.id, profile]));
    const gameById = new Map((games as Game[]).map((game) => [game.id, game]));
    const bookingById = new Map((bookings as Booking[]).map((booking) => [booking.id, booking]));
    const paymentById = new Map((bookingPayments as Payment[]).map((payment) => [payment.id, payment]));
    const refundRequestGameById = new Map<number, number>();
    const latestAttemptByRequestId = new Map<number, SumUpRefundAttempt>();
    const bookingsByGame = new Map<number, number>();
    const paymentRecordsByGame = new Map<number, number>();
    const paidPaymentsByGame = new Map<number, number>();
    const walletBookingsByGame = new Map<number, number>();
    const walletRecordsByGame = new Map<number, number>();
    const waitingListByGame = new Map<number, number>();
    const cancellationCreditsByGame = new Map<number, number>();
    const pendingRefundRequestsByGame = new Map<number, number>();
    const completedRefundsByGame = new Map<number, number>();
    const unresolvedRefundAttemptsByGame = new Map<number, number>();
    const refundAttemptsByGame = new Map<number, number>();
    const reminderDeliveriesByGame = new Map<number, number>();
    const waitingListNotificationsByGame = new Map<number, number>();

    ((sumUpRefundAttemptsResult.data ?? []) as SumUpRefundAttempt[]).forEach((attempt) => {
      if (!latestAttemptByRequestId.has(attempt.refund_request_id)) {
        latestAttemptByRequestId.set(attempt.refund_request_id, attempt);
      }
    });

    (bookings as Booking[]).forEach((booking) => increment(bookingsByGame, booking.game_id));

    (bookingPayments as Payment[]).forEach((payment) => increment(paymentRecordsByGame, payment.game_id));

    (bookingPayments as Payment[])
      .filter((payment) => payment.payment_status?.toLowerCase() === "paid" && Number(payment.amount ?? 0) > 0)
      .forEach((payment) => increment(paidPaymentsByGame, payment.game_id));

    waitingListSummary.forEach((entry) => increment(waitingListByGame, entry.game_id));
    waitingListNotifications.forEach((entry) => increment(waitingListNotificationsByGame, entry.game_id));

    reminderDeliveries.forEach((delivery) => increment(reminderDeliveriesByGame, delivery.game_id));

    walletSummaryTransactions.forEach((transaction) => {
      increment(walletRecordsByGame, transaction.game_id ?? getMetadataNumber(transaction.metadata, "original_game_id"));

      if (
        transaction.transaction_type === "wallet_booking_payment" &&
        transaction.status === "completed" &&
        Number(transaction.amount ?? 0) < 0
      ) {
        increment(walletBookingsByGame, transaction.game_id);
      }

      if (transaction.transaction_type === "game_cancelled_credit" && transaction.status === "completed") {
        increment(
          cancellationCreditsByGame,
          transaction.game_id ?? getMetadataNumber(transaction.metadata, "original_game_id")
        );
      }
    });

    ((refundRequestsResult.data ?? []) as RefundRequest[]).forEach((request) => {
      const originalGameId = getMetadataNumber(request.metadata, "original_game_id");

      if (originalGameId) {
        refundRequestGameById.set(request.id, originalGameId);
      }

      if (request.status === "pending" && originalGameId) {
        increment(pendingRefundRequestsByGame, originalGameId);
      }
    });

    walletSummaryTransactions.forEach((transaction) => {
      if (transaction.transaction_type !== "refund_completed" || transaction.status !== "completed") {
        return;
      }

      const refundRequestId = getMetadataNumber(transaction.metadata, "refund_request_id");
      increment(
        completedRefundsByGame,
        (refundRequestId ? refundRequestGameById.get(refundRequestId) : null) ??
          getMetadataNumber(transaction.metadata, "original_game_id") ??
          transaction.game_id
      );
    });

    const refundRequests = ((refundRequestsResult.data ?? []) as RefundRequest[])
      .filter((request) => request.status === "pending" || request.status === "processing")
      .map((request) => {
      const profile = request.user_id ? profileById.get(request.user_id) : null;
      const sourceWalletTransactionId = getMetadataNumber(request.metadata, "source_wallet_transaction_id");
      const originalPaymentId = getMetadataNumber(request.metadata, "original_payment_id");
      const originalGameId = getMetadataNumber(request.metadata, "original_game_id");
      const originalBookingId = getMetadataNumber(request.metadata, "original_booking_id");
      const originalPayment = originalPaymentId ? paymentById.get(originalPaymentId) : null;
      const originalGame = originalGameId ? gameById.get(originalGameId) : null;
      const originalBooking = originalBookingId ? bookingById.get(originalBookingId) : null;
      const sumUpRefundAttempt = latestAttemptByRequestId.get(request.id) ?? null;

      return {
        ...request,
        player_name: profile?.username ?? null,
        player_email: profile?.email ?? null,
        source_wallet_transaction_id: sourceWalletTransactionId,
        original_payment_id: originalPaymentId,
        original_game_id: originalGameId,
        original_booking_id: originalBookingId,
        source_game_title: originalGame?.title ?? null,
        source_booking_player_name: originalBooking?.player_name ?? null,
        source_payment_status: originalPayment?.payment_status ?? null,
        source_payment_checkout_reference: null,
        source_payment_transaction_code: null,
        sumup_refund_attempt_id: sumUpRefundAttempt?.id ?? null,
        sumup_refund_attempt_status: sumUpRefundAttempt?.status ?? null,
        sumup_refund_attempt_error: sumUpRefundAttempt?.error_message ?? null,
      };
    });
    const waitingList = waitingListResult.data ?? [];

    ((sumUpRefundAttemptsResult.data ?? []) as SumUpRefundAttempt[]).forEach((attempt) => {
      const paymentGameId = attempt.booking_payment_id
        ? paymentById.get(attempt.booking_payment_id)?.game_id
        : null;
      const refundRequestGameId = refundRequestGameById.get(attempt.refund_request_id);

      increment(refundAttemptsByGame, refundRequestGameId ?? paymentGameId);

      if (attempt.status !== "processing" && attempt.status !== "unknown") {
        return;
      }

      increment(unresolvedRefundAttemptsByGame, refundRequestGameId ?? paymentGameId);
    });

    const refundCandidates = buildAdminRefundCandidates({
      games: games as Game[],
      bookings: bookings as Booking[],
      profiles: profiles as Profile[],
      bookingPayments: bookingPayments as Payment[],
      walletTransactions: walletSummaryTransactions,
      sumUpRefundAttempts: (sumUpRefundAttemptsResult.data ?? []) as SumUpRefundAttempt[],
    });
    const refundCandidatesByGame = new Map<number, typeof refundCandidates>();
    const financialRecordsByGame = buildAdminFinancialRecordsByGame({
      games: games as Game[],
      bookings: bookings as Booking[],
      bookingPayments: bookingPayments as Payment[],
      walletTransactions: walletSummaryTransactions,
      sumUpRefundAttempts: (sumUpRefundAttemptsResult.data ?? []) as SumUpRefundAttempt[],
      waitingList: waitingListSummary,
      waitingListNotifications,
      reminderDeliveries,
    });

    refundCandidates.forEach((candidate) => {
      if (!candidate.game_id) {
        return;
      }

      refundCandidatesByGame.set(candidate.game_id, [
        ...(refundCandidatesByGame.get(candidate.game_id) ?? []),
        candidate,
      ]);
    });

    const gamesWithSafetySummaries = (games as Game[]).map((game) => ({
      ...game,
      refund_candidates: refundCandidatesByGame.get(game.id) ?? [],
      financial_records: financialRecordsByGame.get(game.id) ?? [],
      admin_safety: buildAdminGameSafetySummary(
        {
          bookings_count: bookingsByGame.get(game.id) ?? 0,
          payment_records_count: paymentRecordsByGame.get(game.id) ?? 0,
          paid_sumup_payments_count: paidPaymentsByGame.get(game.id) ?? 0,
          wallet_transactions_count: walletRecordsByGame.get(game.id) ?? 0,
          wallet_bookings_count: walletBookingsByGame.get(game.id) ?? 0,
          waiting_list_count: waitingListByGame.get(game.id) ?? 0,
          cancellation_credits_count: cancellationCreditsByGame.get(game.id) ?? 0,
          pending_refund_requests_count: pendingRefundRequestsByGame.get(game.id) ?? 0,
          completed_refunds_count: completedRefundsByGame.get(game.id) ?? 0,
          unresolved_refund_attempts_count: unresolvedRefundAttemptsByGame.get(game.id) ?? 0,
          refund_attempts_count: refundAttemptsByGame.get(game.id) ?? 0,
          reminder_deliveries_count: reminderDeliveriesByGame.get(game.id) ?? 0,
          waiting_list_notifications_count: waitingListNotificationsByGame.get(game.id) ?? 0,
        },
        game.max_players ?? 0
      ),
    }));

    return Response.json({
      games: gamesWithSafetySummaries,
      bookings,
      profiles,
      booking_payments: safeBookingPayments,
      wallet_transactions: walletTransactions,
      refund_requests: refundRequests,
      waiting_list: waitingList,
      ...getAutomaticSumUpRefundCapabilities(),
      summary: {
        games_count: games.length,
        bookings_count: bookings.length,
        players_count: countUniquePlayers(bookings),
        profiles_count: profiles.length,
        payments_count: bookingPayments.length,
        waiting_list_count: waitingList.length,
        paid_payments_amount_total: sumPaidPaymentAmounts(bookingPayments),
        payments_by_status: countPaymentsByStatus(bookingPayments),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin dashboard.";
    return Response.json({ error: message }, { status: 500 });
  }
}
