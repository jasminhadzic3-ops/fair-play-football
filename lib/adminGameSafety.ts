export type AdminGameLifecycle = "active_upcoming" | "cancelled" | "past_legacy" | "archived";

export type AdminGameSafetyGame = {
  id: number;
  status?: string | null;
  starts_at?: string | null;
  archived_at?: string | null;
  max_players?: number | null;
};

export type AdminGameSafetySummary = {
  bookings_count: number;
  spaces_remaining: number;
  paid_sumup_payments_count: number;
  wallet_bookings_count: number;
  waiting_list_count: number;
  cancellation_credits_count: number;
  pending_refund_requests_count: number;
  completed_refunds_count: number;
  unresolved_refund_attempts_count: number;
  reminder_deliveries_count: number;
  payment_records_count: number;
  wallet_transactions_count: number;
  refund_attempts_count: number;
  waiting_list_notifications_count: number;
  has_financial_history: boolean;
  has_refunds: boolean;
  safe_to_delete: boolean;
  delete_block_reasons: string[];
};

export type AdminGameFilter =
  | "active_upcoming"
  | "cancelled"
  | "past_legacy"
  | "has_financial_history"
  | "has_refunds"
  | "safe_to_delete"
  | "archived"
  | "all";

export function getAdminGameLifecycle(
  game: Pick<AdminGameSafetyGame, "status" | "starts_at" | "archived_at">,
  now = new Date()
): AdminGameLifecycle {
  if (game.archived_at) {
    return "archived";
  }

  if (game.status === "cancelled") {
    return "cancelled";
  }

  if (game.status !== "active") {
    return "past_legacy";
  }

  if (!game.starts_at) {
    return "past_legacy";
  }

  const startsAt = new Date(game.starts_at);

  if (Number.isNaN(startsAt.getTime()) || startsAt <= now) {
    return "past_legacy";
  }

  return "active_upcoming";
}

export function isValidAdminMoveDestination(
  game: AdminGameSafetyGame,
  currentGameId: number,
  bookingsCount: number,
  now = new Date()
) {
  if (game.id === currentGameId) {
    return false;
  }

  if (game.archived_at) {
    return false;
  }

  if (getAdminGameLifecycle(game, now) !== "active_upcoming") {
    return false;
  }

  return bookingsCount < (game.max_players ?? 0);
}

export function formatCountReason(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function buildAdminGameSafetySummary(
  counts: Omit<
    AdminGameSafetySummary,
    "spaces_remaining" | "has_financial_history" | "has_refunds" | "safe_to_delete" | "delete_block_reasons"
  >,
  maxPlayers: number
): AdminGameSafetySummary {
  const spacesRemaining = Math.max(0, maxPlayers - counts.bookings_count);
  const hasRefunds =
    counts.pending_refund_requests_count > 0 ||
    counts.completed_refunds_count > 0 ||
    counts.unresolved_refund_attempts_count > 0;
  const hasFinancialHistory =
    counts.paid_sumup_payments_count > 0 ||
    counts.payment_records_count > 0 ||
    counts.wallet_bookings_count > 0 ||
    counts.wallet_transactions_count > 0 ||
    counts.cancellation_credits_count > 0 ||
    hasRefunds;

  const deleteBlockReasons = [
    counts.bookings_count > 0 ? formatCountReason(counts.bookings_count, "booking") : null,
    counts.paid_sumup_payments_count > 0
      ? formatCountReason(counts.paid_sumup_payments_count, "paid payment")
      : null,
    counts.payment_records_count > counts.paid_sumup_payments_count
      ? formatCountReason(
          counts.payment_records_count - counts.paid_sumup_payments_count,
          "other payment record"
        )
      : null,
    counts.wallet_bookings_count > 0
      ? formatCountReason(counts.wallet_bookings_count, "wallet booking")
      : null,
    counts.wallet_transactions_count >
    counts.wallet_bookings_count + counts.cancellation_credits_count + counts.completed_refunds_count
      ? formatCountReason(
          counts.wallet_transactions_count -
            counts.wallet_bookings_count -
            counts.cancellation_credits_count -
            counts.completed_refunds_count,
          "other wallet record"
        )
      : null,
    counts.waiting_list_count > 0
      ? formatCountReason(counts.waiting_list_count, "waiting-list entry", "waiting-list entries")
      : null,
    counts.cancellation_credits_count > 0
      ? formatCountReason(counts.cancellation_credits_count, "cancellation credit")
      : null,
    counts.pending_refund_requests_count > 0
      ? formatCountReason(counts.pending_refund_requests_count, "pending refund")
      : null,
    counts.completed_refunds_count > 0
      ? formatCountReason(counts.completed_refunds_count, "completed refund")
      : null,
    counts.unresolved_refund_attempts_count > 0
      ? formatCountReason(counts.unresolved_refund_attempts_count, "unresolved refund attempt")
      : null,
    counts.refund_attempts_count > counts.unresolved_refund_attempts_count
      ? formatCountReason(
          counts.refund_attempts_count - counts.unresolved_refund_attempts_count,
          "resolved refund attempt"
        )
      : null,
    counts.reminder_deliveries_count > 0
      ? formatCountReason(counts.reminder_deliveries_count, "reminder delivery", "reminder deliveries")
      : null,
    counts.waiting_list_notifications_count > 0
      ? formatCountReason(
          counts.waiting_list_notifications_count,
          "waiting-list notification"
        )
      : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    ...counts,
    spaces_remaining: spacesRemaining,
    has_financial_history: hasFinancialHistory,
    has_refunds: hasRefunds,
    safe_to_delete: deleteBlockReasons.length === 0,
    delete_block_reasons: deleteBlockReasons,
  };
}
