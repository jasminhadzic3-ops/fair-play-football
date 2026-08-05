import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type NotificationType =
  | "new_game_available"
  | "booking_confirmed"
  | "booking_reminder"
  | "game_half_full"
  | "waiting_list_spot_available"
  | "game_cancelled"
  | "wallet_credit_added"
  | "refund_processed";

export type NotificationCategory =
  | "games"
  | "bookings"
  | "wallet"
  | "refunds"
  | "waiting_list";

type CreateNotificationParams = {
  userId: string | null | undefined;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  icon: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  gameId?: number | null;
  bookingId?: number | null;
  walletTransactionId?: number | null;
  refundRequestId?: number | null;
  waitingListId?: number | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
};

export type NotificationGame = {
  id: number;
  title?: string | null;
  location?: string | null;
  time?: string | null;
  starts_at?: string | null;
  price?: number | string | null;
};

export type NotificationRecipient = {
  userId: string;
  playerName?: string | null;
};

function formatNotificationAmount(amount: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getGameDayLabel(game: NotificationGame | null | undefined) {
  if (!game?.starts_at) {
    return null;
  }

  const startsAt = new Date(game.starts_at);

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  return startsAt.toLocaleDateString("en-GB", { weekday: "long" });
}

function compactMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
  );
}

export async function createNotification({
  userId,
  type,
  category,
  title,
  body,
  icon,
  actionUrl = null,
  actionLabel = null,
  gameId = null,
  bookingId = null,
  walletTransactionId = null,
  refundRequestId = null,
  waitingListId = null,
  dedupeKey = null,
  metadata = {},
  expiresAt = null,
}: CreateNotificationParams) {
  if (!userId) {
    return { skipped: true, reason: "missing_user" };
  }

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      category,
      title,
      body,
      icon,
      action_url: actionUrl,
      action_label: actionLabel,
      game_id: gameId,
      booking_id: bookingId,
      wallet_transaction_id: walletTransactionId,
      refund_request_id: refundRequestId,
      waiting_list_id: waitingListId,
      dedupe_key: dedupeKey,
      metadata: compactMetadata(metadata),
      expires_at: expiresAt,
    })
    .select("id")
    .single<{ id: number }>();

  if (error) {
    if (error.code === "23505") {
      return { skipped: true, reason: "duplicate" };
    }

    throw error;
  }

  return { skipped: false, notificationId: data.id };
}

export function gameActionUrl(gameId: number | null | undefined) {
  return gameId ? `/?open_game_id=${encodeURIComponent(String(gameId))}#games` : "/#games";
}

export function walletActionUrl() {
  return "/wallet";
}

export function bookingsActionUrl() {
  return "/my-bookings";
}

export function getGameDisplayLine(game: NotificationGame | null | undefined) {
  if (!game) {
    return "Open Fair Play Football for the latest details.";
  }

  const parts = [
    game.title || "Fair Play Football game",
    game.time || null,
    game.location || null,
  ].filter(Boolean);

  return parts.join(" • ") || "Open Fair Play Football for the latest details.";
}

export async function createNewGameAvailableNotification({
  recipient,
  game,
}: {
  recipient: NotificationRecipient;
  game: NotificationGame;
}) {
  return createNotification({
    userId: recipient.userId,
    type: "new_game_available",
    category: "games",
    title: "New match is live",
    body: getGameDisplayLine(game),
    icon: "⚽",
    actionUrl: gameActionUrl(game.id),
    actionLabel: "View & Book Your Spot",
    gameId: game.id,
    dedupeKey: `notification:new_game_available:game:${game.id}:user:${recipient.userId}`,
  });
}

export async function createBookingConfirmedNotification({
  userId,
  bookingId,
  game,
}: {
  userId: string;
  bookingId: number;
  game: NotificationGame;
}) {
  return createNotification({
    userId,
    type: "booking_confirmed",
    category: "bookings",
    title: "You're Booked In",
    body: getGameDisplayLine(game),
    icon: "✅",
    actionUrl: bookingsActionUrl(),
    actionLabel: "View Your Booking",
    gameId: game.id,
    bookingId,
    dedupeKey: `notification:booking_confirmed:booking:${bookingId}`,
  });
}

export async function createBookingReminderNotification({
  userId,
  bookingId,
  game,
}: {
  userId: string;
  bookingId: number;
  game: NotificationGame;
}) {
  return createNotification({
    userId,
    type: "booking_reminder",
    category: "bookings",
    title: "You're playing soon",
    body: getGameDisplayLine(game),
    icon: "⏰",
    actionUrl: bookingsActionUrl(),
    actionLabel: "View Booking",
    gameId: game.id,
    bookingId,
    dedupeKey: `notification:booking_reminder:booking:${bookingId}`,
  });
}

export async function createGameHalfFullNotification({
  recipient,
  game,
}: {
  recipient: NotificationRecipient;
  game: NotificationGame;
}) {
  return createNotification({
    userId: recipient.userId,
    type: "game_half_full",
    category: "games",
    title: "Game filling up fast",
    body: getGameDisplayLine(game),
    icon: "🔥",
    actionUrl: gameActionUrl(game.id),
    actionLabel: "Book Now",
    gameId: game.id,
    dedupeKey: `notification:game_half_full:game:${game.id}:user:${recipient.userId}`,
  });
}

export async function createWaitingListSpotAvailableNotification({
  userId,
  waitingListId,
  game,
}: {
  userId: string;
  waitingListId: number;
  game: NotificationGame;
}) {
  return createNotification({
    userId,
    type: "waiting_list_spot_available",
    category: "waiting_list",
    title: "A place is now available",
    body: "Your spot isn't reserved until payment is completed.",
    icon: "🎉",
    actionUrl: gameActionUrl(game.id),
    actionLabel: "Complete Your Booking",
    gameId: game.id,
    waitingListId,
    dedupeKey: `notification:waiting_list_spot_available:waiting_list:${waitingListId}:game:${game.id}`,
  });
}

export async function createGameCancelledNotification({
  userId,
  game,
}: {
  userId: string;
  game: NotificationGame;
}) {
  const gameDayLabel = getGameDayLabel(game);

  return createNotification({
    userId,
    type: "game_cancelled",
    category: "games",
    title: gameDayLabel ? `${gameDayLabel} game cancelled` : "Game cancelled",
    body: "Your payment has been returned to your Fair Play Wallet as credit.",
    icon: "❌",
    actionUrl: walletActionUrl(),
    actionLabel: "Open My Wallet",
    gameId: game.id,
    dedupeKey: `notification:game_cancelled:game:${game.id}:user:${userId}`,
  });
}

export async function createWalletCreditNotification({
  userId,
  walletTransactionId,
  amount,
  reason,
  gameId = null,
  dedupeKey,
}: {
  userId: string;
  walletTransactionId?: number | null;
  amount: number;
  reason: "Cancelled game" | "Player cancellation" | "Refund credited to your wallet" | "Admin credit";
  gameId?: number | null;
  dedupeKey?: string;
}) {
  const formattedAmount = formatNotificationAmount(amount);

  return createNotification({
    userId,
    type: "wallet_credit_added",
    category: "wallet",
    title: `${formattedAmount} added to your wallet`,
    body: reason,
    icon: "💳",
    actionUrl: walletActionUrl(),
    actionLabel: "View Wallet",
    gameId,
    walletTransactionId: walletTransactionId ?? null,
    dedupeKey:
      dedupeKey ??
      (walletTransactionId
        ? `notification:wallet_credit_added:wallet_transaction:${walletTransactionId}`
        : null),
    metadata: { reason },
  });
}

export async function createRefundProcessedNotification({
  userId,
  refundRequestId,
  amount,
}: {
  userId: string;
  refundRequestId: number;
  amount: number;
}) {
  const formattedAmount = formatNotificationAmount(amount);

  return createNotification({
    userId,
    type: "refund_processed",
    category: "refunds",
    title: "Refund processed",
    body: `${formattedAmount} was returned to your original payment method.`,
    icon: "💷",
    actionUrl: walletActionUrl(),
    actionLabel: "View Wallet",
    refundRequestId,
    dedupeKey: `notification:refund_processed:refund_request:${refundRequestId}`,
  });
}
