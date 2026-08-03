export type GameLifecycle =
  | "draft"
  | "active_bookable"
  | "full"
  | "completed"
  | "cancelled"
  | "archived";

export type GameLifecycleGame = {
  status?: string | null;
  starts_at?: string | Date | null;
  archived_at?: string | null;
  max_players?: number | null;
};

export type GameLifecycleContext = {
  bookingCount?: number | null;
  maxPlayers?: number | null;
  now?: Date;
};

function parseStartsAt(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getCapacity(game: GameLifecycleGame, context: GameLifecycleContext) {
  const maxPlayers = context.maxPlayers ?? game.max_players ?? null;

  return typeof maxPlayers === "number" && Number.isFinite(maxPlayers) && maxPlayers > 0
    ? maxPlayers
    : null;
}

function getBookingCount(context: GameLifecycleContext) {
  const bookingCount = context.bookingCount ?? 0;

  return typeof bookingCount === "number" && Number.isFinite(bookingCount)
    ? Math.max(0, bookingCount)
    : 0;
}

export function getGameLifecycle(
  game: GameLifecycleGame,
  context: GameLifecycleContext = {}
): GameLifecycle {
  if (game.archived_at) {
    return "archived";
  }

  if (game.status === "cancelled") {
    return "cancelled";
  }

  if (game.status === "draft") {
    return "draft";
  }

  if (game.status !== "active") {
    return "draft";
  }

  const startsAt = parseStartsAt(game.starts_at);

  if (!startsAt) {
    return "draft";
  }

  const now = context.now ?? new Date();

  if (startsAt <= now) {
    return "completed";
  }

  const maxPlayers = getCapacity(game, context);

  if (maxPlayers !== null && getBookingCount(context) >= maxPlayers) {
    return "full";
  }

  return "active_bookable";
}

export function isArchived(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  return getGameLifecycle(game, context) === "archived";
}

export function isCancelled(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  return getGameLifecycle(game, context) === "cancelled";
}

export function isCompleted(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  return getGameLifecycle(game, context) === "completed";
}

export function isBookable(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  return getGameLifecycle(game, context) === "active_bookable";
}

export function isPubliclyVisible(
  game: GameLifecycleGame,
  context: GameLifecycleContext = {}
) {
  const lifecycle = getGameLifecycle(game, context);

  return lifecycle === "active_bookable" || lifecycle === "full";
}

export function canPlayerLeave(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  const lifecycle = getGameLifecycle(game, context);

  return lifecycle === "active_bookable" || lifecycle === "full";
}

export function canJoinWaitingList(
  game: GameLifecycleGame,
  context: GameLifecycleContext = {}
) {
  return getGameLifecycle(game, context) === "full";
}

export function canAdminCancel(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  const lifecycle = getGameLifecycle(game, context);

  return lifecycle === "active_bookable" || lifecycle === "full";
}

export function canArchive(game: GameLifecycleGame, context: GameLifecycleContext = {}) {
  const lifecycle = getGameLifecycle(game, context);

  return lifecycle === "cancelled" || lifecycle === "completed";
}
