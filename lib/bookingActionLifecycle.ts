import { getGameLifecycle, type GameLifecycleGame } from "@/lib/gameLifecycle";

export type BookingActionLifecycleReason =
  | "source_game_not_found"
  | "source_game_completed"
  | "source_game_cancelled"
  | "source_game_archived"
  | "source_game_not_active"
  | "source_game_missing_starts_at";

export type BookingActionLifecycleBlock = {
  reason: BookingActionLifecycleReason;
  message: string;
  status: number;
};

export function getBookingActionLifecycleBlock(
  game: GameLifecycleGame | null | undefined,
  now = new Date()
): BookingActionLifecycleBlock | null {
  if (!game) {
    return {
      reason: "source_game_not_found",
      message: "This booking cannot be changed because its game could not be found.",
      status: 409,
    };
  }

  if (game.archived_at) {
    return {
      reason: "source_game_archived",
      message: "This booking can no longer be changed because the game has been archived.",
      status: 409,
    };
  }

  if (game.status === "cancelled") {
    return {
      reason: "source_game_cancelled",
      message: "This booking can no longer be changed because the game has been cancelled.",
      status: 409,
    };
  }

  if (game.status !== "active") {
    return {
      reason: "source_game_not_active",
      message: "This booking can only be changed for active upcoming games.",
      status: 409,
    };
  }

  if (!game.starts_at) {
    return {
      reason: "source_game_missing_starts_at",
      message: "This booking needs support because the kickoff time is not fully confirmed.",
      status: 409,
    };
  }

  if (getGameLifecycle(game, { now }) === "completed") {
    return {
      reason: "source_game_completed",
      message: "This booking can no longer be changed because the game has already started.",
      status: 409,
    };
  }

  return null;
}
