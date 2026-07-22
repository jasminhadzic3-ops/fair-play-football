import { NextRequest } from "next/server";
import { buildAdminGameSafetySummary } from "@/lib/adminGameSafety";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import {
  cancelGameWithWalletCredits,
  GameCancellationError,
  retryGameCancellationEmails,
} from "@/lib/gameCancellation";
import { parseLondonKickoff } from "@/lib/londonKickoff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GamePayload = {
  action?: unknown;
  cancellation_reason?: unknown;
  title?: unknown;
  location?: unknown;
  time?: unknown;
  kickoff_date?: unknown;
  kickoff_time?: unknown;
  price?: unknown;
  max_players?: unknown;
};

function parseGamePayload(body: GamePayload | null) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const legacyTime = typeof body?.time === "string" ? body.time.trim() : "";
  const hasKickoffDate = typeof body?.kickoff_date === "string" && body.kickoff_date.trim() !== "";
  const hasKickoffTime = typeof body?.kickoff_time === "string" && body.kickoff_time.trim() !== "";
  const hasStructuredKickoff = hasKickoffDate || hasKickoffTime;
  const kickoff = hasStructuredKickoff
    ? parseLondonKickoff(body?.kickoff_date, body?.kickoff_time)
    : null;
  const price = Number(body?.price);
  const maxPlayers = Number(body?.max_players);

  if (
    !title ||
    !location ||
    (hasStructuredKickoff ? !kickoff : !legacyTime) ||
    Number.isNaN(price) ||
    Number.isNaN(maxPlayers) ||
    ![12, 14, 16].includes(maxPlayers)
  ) {
    return null;
  }

  return {
    title,
    location,
    time: kickoff?.displayTime ?? legacyTime,
    ...(kickoff ? { starts_at: kickoff.startsAtIso } : {}),
    price,
    max_players: maxPlayers,
  };
}

function parseGameId(id: string) {
  const gameId = Number(id);

  return Number.isInteger(gameId) && gameId > 0 ? gameId : null;
}

function isCancelGamePayload(body: GamePayload | null): body is GamePayload {
  return body?.action === "cancel";
}

function isRetryCancellationEmailsPayload(body: GamePayload | null): body is GamePayload {
  return body?.action === "retry_cancellation_emails";
}

function parseCancellationReason(body: GamePayload | null) {
  return typeof body?.cancellation_reason === "string" ? body.cancellation_reason.trim() || null : null;
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

type WalletTransactionSummary = {
  id: number;
  booking_id: number | null;
  payment_id: number | null;
  transaction_type: string | null;
  status: string | null;
  amount: number | string | null;
  metadata?: Record<string, unknown> | null;
};

function addWalletTransactions(
  transactionsById: Map<number, WalletTransactionSummary>,
  transactions: WalletTransactionSummary[] | null | undefined
) {
  (transactions ?? []).forEach((transaction) => {
    transactionsById.set(transaction.id, transaction);
  });
}

function addRowsById<T extends { id: number }>(
  rowsById: Map<number, T>,
  rows: T[] | null | undefined
) {
  (rows ?? []).forEach((row) => {
    rowsById.set(row.id, row);
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const gameId = parseGameId(id);

    if (!gameId) {
      return Response.json({ error: "Invalid game id." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);

    if (isCancelGamePayload(body)) {
      const result = await cancelGameWithWalletCredits({
        gameId,
        adminUserId: adminUser.id,
        cancellationReason: parseCancellationReason(body),
      });

      return Response.json(result);
    }

    if (isRetryCancellationEmailsPayload(body)) {
      const emailWarning = await retryGameCancellationEmails({ gameId });

      return Response.json({
        ok: true,
        ...(emailWarning ? { email_warning: emailWarning } : {}),
      });
    }

    const payload = parseGamePayload(body);

    if (!payload) {
      return Response.json(
        { error: "Please fill in all fields with a valid London kickoff date and time. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8)." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("games")
      .update(payload)
      .eq("id", gameId)
      .select("*")
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ game: data });
  } catch (error) {
    if (error instanceof GameCancellationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unable to update game.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const gameId = parseGameId(id);

    if (!gameId) {
      return Response.json({ error: "Invalid game id." }, { status: 400 });
    }

    const [
      bookingsResult,
      paymentsResult,
      walletTransactionsResult,
      originalGameWalletTransactionsResult,
      waitingListResult,
      waitingListNotificationsResult,
      reminderDeliveriesResult,
    ] = await Promise.all([
      supabaseAdmin.from("bookings").select("id").eq("game_id", gameId),
      supabaseAdmin.from("booking_payments").select("id,payment_status,amount").eq("game_id", gameId),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,booking_id,payment_id,transaction_type,status,amount,metadata")
        .eq("game_id", gameId),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,booking_id,payment_id,transaction_type,status,amount,metadata")
        .eq("metadata->>original_game_id", String(gameId)),
      supabaseAdmin.from("waiting_list").select("id").eq("game_id", gameId),
      supabaseAdmin.from("waiting_list_notifications").select("id").eq("game_id", gameId),
      supabaseAdmin.from("game_reminder_deliveries").select("id").eq("game_id", gameId),
    ]);

    const firstPreflightError =
      bookingsResult.error ||
      paymentsResult.error ||
      walletTransactionsResult.error ||
      originalGameWalletTransactionsResult.error ||
      waitingListResult.error ||
      waitingListNotificationsResult.error ||
      reminderDeliveriesResult.error;

    if (firstPreflightError) {
      return Response.json(
        { error: firstPreflightError.message || "Unable to check game records." },
        { status: 500 }
      );
    }

    const bookingPayments = (paymentsResult.data ?? []) as Array<{
      id: number;
      payment_status: string | null;
      amount: number | string | null;
    }>;
    const bookingIds = ((bookingsResult.data ?? []) as Array<{ id: number }>).map(
      (booking) => booking.id
    );
    const waitingListIds = ((waitingListResult.data ?? []) as Array<{ id: number }>).map(
      (waitingListEntry) => waitingListEntry.id
    );
    const paymentIds = bookingPayments.map((payment) => payment.id);
    const walletTransactionsById = new Map<number, WalletTransactionSummary>();
    const waitingListNotificationsById = new Map<number, { id: number }>();

    addWalletTransactions(walletTransactionsById, walletTransactionsResult.data as WalletTransactionSummary[]);
    addWalletTransactions(
      walletTransactionsById,
      originalGameWalletTransactionsResult.data as WalletTransactionSummary[]
    );
    addRowsById(waitingListNotificationsById, waitingListNotificationsResult.data as Array<{ id: number }>);

    if (waitingListIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("waiting_list_notifications")
        .select("id")
        .in("waiting_list_id", waitingListIds);

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      addRowsById(waitingListNotificationsById, data as Array<{ id: number }>);
    }

    if (bookingIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("wallet_transactions")
        .select("id,booking_id,payment_id,transaction_type,status,amount,metadata")
        .in("booking_id", bookingIds);

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      addWalletTransactions(walletTransactionsById, data as WalletTransactionSummary[]);
    }

    if (paymentIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("wallet_transactions")
        .select("id,booking_id,payment_id,transaction_type,status,amount,metadata")
        .in("payment_id", paymentIds);

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      addWalletTransactions(walletTransactionsById, data as WalletTransactionSummary[]);
    }

    let walletTransactions = Array.from(walletTransactionsById.values());
    const refundRequestIds = walletTransactions
      .filter((transaction) => transaction.transaction_type === "refund_requested")
      .map((transaction) => transaction.id);
    const refundAttemptById = new Map<number, string | null>();

    if (refundRequestIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("wallet_transactions")
        .select("id,booking_id,payment_id,transaction_type,status,amount,metadata")
        .eq("transaction_type", "refund_completed")
        .in("metadata->>refund_request_id", refundRequestIds.map(String));

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      addWalletTransactions(walletTransactionsById, data as WalletTransactionSummary[]);
      walletTransactions = Array.from(walletTransactionsById.values());
    }

    if (paymentIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("sumup_refund_attempts")
        .select("id,status")
        .in("booking_payment_id", paymentIds);

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      (data ?? []).forEach((attempt) => refundAttemptById.set(attempt.id, attempt.status ?? null));
    }

    if (refundRequestIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("sumup_refund_attempts")
        .select("id,status")
        .in("refund_request_id", refundRequestIds);

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      (data ?? []).forEach((attempt) => refundAttemptById.set(attempt.id, attempt.status ?? null));
    }

    const summary = buildAdminGameSafetySummary(
      {
        bookings_count: (bookingsResult.data ?? []).length,
        payment_records_count: bookingPayments.length,
        paid_sumup_payments_count: bookingPayments.filter(
          (payment) => payment.payment_status?.toLowerCase() === "paid" && Number(payment.amount ?? 0) > 0
        ).length,
        wallet_transactions_count: walletTransactions.length,
        wallet_bookings_count: walletTransactions.filter(
          (transaction) =>
            transaction.transaction_type === "wallet_booking_payment" &&
            transaction.status === "completed" &&
            Number(transaction.amount ?? 0) < 0
        ).length,
        waiting_list_count: (waitingListResult.data ?? []).length,
        cancellation_credits_count: walletTransactions.filter(
          (transaction) => transaction.transaction_type === "game_cancelled_credit" && transaction.status === "completed"
        ).length,
        pending_refund_requests_count: walletTransactions.filter(
          (transaction) => transaction.transaction_type === "refund_requested" && transaction.status === "pending"
        ).length,
        completed_refunds_count: walletTransactions.filter(
          (transaction) =>
            transaction.transaction_type === "refund_completed" &&
            transaction.status === "completed" &&
            getMetadataNumber(transaction.metadata, "refund_request_id") !== null
        ).length,
        unresolved_refund_attempts_count: Array.from(refundAttemptById.values()).filter(
          (status) => status === "processing" || status === "unknown"
        ).length,
        refund_attempts_count: refundAttemptById.size,
        reminder_deliveries_count: (reminderDeliveriesResult.data ?? []).length,
        waiting_list_notifications_count: waitingListNotificationsById.size,
      },
      0
    );

    if (!summary.safe_to_delete) {
      return Response.json(
        {
          error: `This game cannot be deleted because it has ${summary.delete_block_reasons.join(
            ", "
          )}. Keep it for records or cancel it instead.`,
          delete_block_reasons: summary.delete_block_reasons,
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from("games").delete().eq("id", gameId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete game.";
    return Response.json({ error: message }, { status: 500 });
  }
}
