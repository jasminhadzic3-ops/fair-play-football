import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  isGameReminderEmailEnabled,
  sendGameReminderEmail,
  type GameReminderEmailGame,
} from "@/lib/email/gameReminder";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

const reminderWindowStartHours = 6;
const reminderWindowEndHours = 36;
const minHoursBeforeKickoff = 6;
const staleSendingMinutes = 10;
const maxAttempts = 3;
const defaultMaxDeliveriesPerRun = 50;

type GameRow = GameReminderEmailGame & {
  starts_at: string | null;
  status: string | null;
  archived_at: string | null;
};

type BookingRow = {
  id: number;
  game_id: number | null;
  user_id: string | null;
  player_name: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

type BookingPaymentRow = {
  booking_id: number | null;
  payment_status: string | null;
  amount: number | string | null;
};

type WalletTransactionRow = {
  booking_id: number | null;
  transaction_type: string | null;
  status: string | null;
  amount: number | string | null;
};

type DeliveryRow = {
  id: number;
  game_id: number;
  user_id: string;
  booking_id: number;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
};

type ReminderCandidate = {
  game: GameRow;
  booking: BookingRow;
  profile: ProfileRow;
};

export type RunGameReminderSchedulerResult = {
  disabled: boolean;
  gamesChecked: number;
  deliveriesCreated: number;
  deliveriesProcessed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
};

type RunGameReminderSchedulerParams = {
  now?: Date;
  maxDeliveriesPerRun?: number;
};

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function deliveryKey(gameId: number, userId: string) {
  return `${gameId}:${userId}`;
}

function sanitizeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();

    if (code) {
      return code.slice(0, 80);
    }
  }

  return error instanceof Error ? error.name.slice(0, 80) : "reminder_send_error";
}

function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to send game reminder.";

  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

function getRetryTime(now: Date, attempts: number) {
  return addMinutes(now, attempts <= 1 ? 15 : 60).toISOString();
}

function isDeliveryDue(delivery: DeliveryRow, now: Date) {
  if (delivery.status === "sent" || delivery.status === "skipped") {
    return false;
  }

  if (delivery.status === "sending") {
    const updatedAt = new Date(delivery.updated_at);

    return (
      !Number.isNaN(updatedAt.getTime()) &&
      updatedAt.getTime() <= addMinutes(now, -staleSendingMinutes).getTime()
    );
  }

  const nextAttemptAt = new Date(delivery.next_attempt_at);

  return Number.isNaN(nextAttemptAt.getTime()) || nextAttemptAt <= now;
}

function isGameStillReminderEligible(game: GameRow | undefined, now: Date) {
  if (!game || game.status !== "active" || game.archived_at || !game.starts_at) {
    return false;
  }

  const startsAt = new Date(game.starts_at);

  return (
    !Number.isNaN(startsAt.getTime()) &&
    startsAt > addHours(now, minHoursBeforeKickoff) &&
    startsAt <= addHours(now, reminderWindowEndHours)
  );
}

async function fetchGamesForNewDeliveries(now: Date) {
  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,price,starts_at,status,archived_at")
    .eq("status", "active")
    .is("archived_at", null)
    .not("starts_at", "is", null)
    .gte("starts_at", addHours(now, reminderWindowStartHours).toISOString())
    .lte("starts_at", addHours(now, reminderWindowEndHours).toISOString());

  if (error) {
    throw error;
  }

  return (data ?? []) as GameRow[];
}

async function fetchDueDeliveries(now: Date) {
  const { data, error } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .select("id,game_id,user_id,booking_id,status,attempts,next_attempt_at,created_at,updated_at")
    .in("status", ["pending", "failed", "sending"])
    .order("next_attempt_at", { ascending: true })
    .limit(defaultMaxDeliveriesPerRun * 3);

  if (error) {
    throw error;
  }

  return ((data ?? []) as DeliveryRow[]).filter((delivery) => isDeliveryDue(delivery, now));
}

async function buildCandidatesForGames(games: GameRow[]) {
  if (games.length === 0) {
    return new Map<string, ReminderCandidate>();
  }

  const gameById = new Map(games.map((game) => [game.id, game]));
  const gameIds = Array.from(gameById.keys());
  const { data: bookingsData, error: bookingsError } = await supabaseAdmin
    .from("bookings")
    .select("id,game_id,user_id,player_name")
    .in("game_id", gameIds);

  if (bookingsError) {
    throw bookingsError;
  }

  const bookings = ((bookingsData ?? []) as BookingRow[]).filter(
    (booking) => booking.id && booking.game_id && booking.user_id
  );
  const bookingIds = bookings.map((booking) => booking.id);
  const userIds = Array.from(
    new Set(bookings.map((booking) => booking.user_id).filter((userId): userId is string => Boolean(userId)))
  );

  if (bookingIds.length === 0 || userIds.length === 0) {
    return new Map<string, ReminderCandidate>();
  }

  const [profilesResult, paymentsResult, walletResult] = await Promise.all([
    supabaseAdmin.from("profiles").select("id,email,username").in("id", userIds),
    supabaseAdmin
      .from("booking_payments")
      .select("booking_id,payment_status,amount")
      .in("booking_id", bookingIds),
    supabaseAdmin
      .from("wallet_transactions")
      .select("booking_id,transaction_type,status,amount")
      .in("booking_id", bookingIds)
      .eq("transaction_type", "wallet_booking_payment"),
  ]);

  const firstError = profilesResult.error || paymentsResult.error || walletResult.error;

  if (firstError) {
    throw firstError;
  }

  const profileById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );
  const paidBookingIds = new Set(
    ((paymentsResult.data ?? []) as BookingPaymentRow[])
      .filter(
        (payment) =>
          payment.booking_id &&
          payment.payment_status === "paid" &&
          Number(payment.amount ?? 0) > 0
      )
      .map((payment) => payment.booking_id as number)
  );
  const walletBookingIds = new Set(
    ((walletResult.data ?? []) as WalletTransactionRow[])
      .filter(
        (transaction) =>
          transaction.booking_id &&
          transaction.transaction_type === "wallet_booking_payment" &&
          transaction.status === "completed" &&
          Number(transaction.amount ?? 0) < 0
      )
      .map((transaction) => transaction.booking_id as number)
  );
  const candidates = new Map<string, ReminderCandidate>();

  bookings.forEach((booking) => {
    if (!booking.game_id || !booking.user_id) {
      return;
    }

    if (!paidBookingIds.has(booking.id) && !walletBookingIds.has(booking.id)) {
      return;
    }

    const profile = profileById.get(booking.user_id);

    if (!profile?.email) {
      return;
    }

    const key = deliveryKey(booking.game_id, booking.user_id);

    if (!candidates.has(key)) {
      candidates.set(key, {
        game: gameById.get(booking.game_id) as GameRow,
        booking,
        profile,
      });
    }
  });

  return candidates;
}

async function createMissingDeliveries(candidates: Map<string, ReminderCandidate>, now: Date) {
  const rows = Array.from(candidates.values()).map((candidate) => ({
    game_id: candidate.game.id,
    user_id: candidate.profile.id,
    booking_id: candidate.booking.id,
    status: "pending",
    attempts: 0,
    next_attempt_at: now.toISOString(),
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { data, error } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .upsert(rows, { onConflict: "game_id,user_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw error;
  }

  return (data ?? []).length;
}

async function fetchGamesByIds(gameIds: number[]) {
  if (gameIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,price,starts_at,status,archived_at")
    .in("id", gameIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as GameRow[];
}

async function markSkipped(delivery: DeliveryRow, reason: string) {
  const { error } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .update({
      status: "skipped",
      sanitized_error_code: reason,
      sanitized_error_message: "Reminder skipped because the delivery is no longer eligible.",
    })
    .eq("id", delivery.id)
    .neq("status", "sent");

  if (error) {
    throw error;
  }
}

async function claimDelivery(delivery: DeliveryRow, now: Date) {
  const { data, error } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .update({
      status: "sending",
      attempts: delivery.attempts + 1,
      next_attempt_at: getRetryTime(now, delivery.attempts + 1),
      sanitized_error_code: null,
      sanitized_error_message: null,
    })
    .eq("id", delivery.id)
    .eq("status", delivery.status)
    .eq("attempts", delivery.attempts)
    .select("id,game_id,user_id,booking_id,status,attempts,next_attempt_at,created_at,updated_at")
    .maybeSingle<DeliveryRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function markSent(delivery: DeliveryRow, providerMessageId: string | null) {
  const { error } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
      sanitized_error_code: null,
      sanitized_error_message: null,
    })
    .eq("id", delivery.id)
    .eq("status", "sending");

  if (error) {
    throw error;
  }
}

async function markFailed(delivery: DeliveryRow, error: unknown, now: Date) {
  const nextAttempts = delivery.attempts;
  const shouldRetry = nextAttempts < maxAttempts;

  const { error: updateError } = await supabaseAdmin
    .from("game_reminder_deliveries")
    .update({
      status: "failed",
      next_attempt_at: shouldRetry ? getRetryTime(now, nextAttempts) : addHours(now, 24 * 365).toISOString(),
      sanitized_error_code: sanitizeErrorCode(error),
      sanitized_error_message: sanitizeErrorMessage(error),
    })
    .eq("id", delivery.id)
    .eq("status", "sending");

  if (updateError) {
    throw updateError;
  }
}

export async function runGameReminderScheduler({
  now = new Date(),
  maxDeliveriesPerRun = defaultMaxDeliveriesPerRun,
}: RunGameReminderSchedulerParams = {}): Promise<RunGameReminderSchedulerResult> {
  assertSupabaseAdminConfigured();

  const result: RunGameReminderSchedulerResult = {
    disabled: false,
    gamesChecked: 0,
    deliveriesCreated: 0,
    deliveriesProcessed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  };

  if (!isGameReminderEmailEnabled()) {
    return { ...result, disabled: true };
  }

  const newDeliveryGames = await fetchGamesForNewDeliveries(now);
  result.gamesChecked = newDeliveryGames.length;

  const newCandidates = await buildCandidatesForGames(newDeliveryGames);
  result.deliveriesCreated = await createMissingDeliveries(newCandidates, now);

  const dueDeliveries = (await fetchDueDeliveries(now)).slice(0, maxDeliveriesPerRun);
  const dueGameIds = Array.from(new Set(dueDeliveries.map((delivery) => delivery.game_id)));
  const dueGames = await fetchGamesByIds(dueGameIds);
  const dueGameById = new Map(dueGames.map((game) => [game.id, game]));
  const eligibleDueGames = dueGames.filter((game) => isGameStillReminderEligible(game, now));
  const dueCandidates = await buildCandidatesForGames(eligibleDueGames);

  for (const delivery of dueDeliveries) {
    const game = dueGameById.get(delivery.game_id);
    const candidate = dueCandidates.get(deliveryKey(delivery.game_id, delivery.user_id));

    if (!isGameStillReminderEligible(game, now) || !candidate) {
      await markSkipped(delivery, "not_eligible");
      result.skipped += 1;
      continue;
    }

    if (delivery.attempts >= maxAttempts) {
      await markSkipped(delivery, "max_attempts_exceeded");
      result.skipped += 1;
      continue;
    }

    const claimedDelivery = await claimDelivery(delivery, now);

    if (!claimedDelivery) {
      continue;
    }

    result.deliveriesProcessed += 1;

    try {
      const emailResult = await sendGameReminderEmail({
        game: candidate.game,
        recipient: {
          userId: candidate.profile.id,
          email: candidate.profile.email as string,
          playerName: candidate.profile.username || candidate.booking.player_name || "Player",
        },
      });

      await markSent(claimedDelivery, emailResult.id ?? null);
      result.sent += 1;
    } catch (error) {
      await markFailed(claimedDelivery, error, now);
      result.failed += 1;

      if (claimedDelivery.attempts < maxAttempts) {
        result.retried += 1;
      }

      Sentry.captureException(error, {
        tags: {
          feature: "game_reminder_scheduler",
          delivery_status: "failed",
        },
        extra: {
          deliveryId: claimedDelivery.id,
          gameId: claimedDelivery.game_id,
          attempts: claimedDelivery.attempts,
          sanitizedErrorCode: sanitizeErrorCode(error),
        },
      });
    }
  }

  return result;
}
