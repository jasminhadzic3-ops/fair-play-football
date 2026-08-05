import { assertSupabaseAdminConfigured, supabaseAdmin } from "./supabaseAdmin";
import { sendWaitingListSpotAvailableEmail } from "./email/waitingListSpotAvailable";
import { isBookable } from "./gameLifecycle";
import { createWaitingListSpotAvailableNotification } from "./notifications";

const openSpaceMessage =
  "A space may be available for this game. Book now to try for the spot. Spots are first paid, first served.";

type WaitingListRow = {
  id: number;
  game_id: number;
  user_id: string;
  player_name: string;
};

type WaitingListNotificationRow = {
  id: number;
};

export async function notifyWaitingListForOpenSpace(gameId: number) {
  assertSupabaseAdminConfigured();

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,price,status,starts_at,archived_at,max_players")
    .eq("id", gameId)
    .maybeSingle();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    return { notifiedCount: 0 };
  }

  const { count: bookingCount, error: bookingCountError } = await supabaseAdmin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);

  if (bookingCountError) {
    throw bookingCountError;
  }

  if (!isBookable(game, { bookingCount: bookingCount ?? 0 })) {
    return { notifiedCount: 0 };
  }

  const { data: waitingRows, error: waitingRowsError } = await supabaseAdmin
    .from("waiting_list")
    .select("id,game_id,user_id,player_name")
    .eq("game_id", gameId)
    .eq("status", "waiting")
    .order("created_at", { ascending: true });

  if (waitingRowsError) {
    throw waitingRowsError;
  }

  const activeWaitingRows = (waitingRows ?? []) as WaitingListRow[];
  let notifiedCount = 0;

  for (const waitingRow of activeWaitingRows) {
    const { data: notification, error } = await supabaseAdmin
      .from("waiting_list_notifications")
      .insert({
        waiting_list_id: waitingRow.id,
        game_id: waitingRow.game_id,
        user_id: waitingRow.user_id,
        player_name: waitingRow.player_name,
        status: "unread",
        message: openSpaceMessage,
      })
      .select("id")
      .single<WaitingListNotificationRow>();

    if (error) {
      if (error.code === "23505") {
        continue;
      }

      throw error;
    }

    notifiedCount += 1;

    await createWaitingListSpotAvailableNotification({
      userId: waitingRow.user_id,
      waitingListId: waitingRow.id,
      game,
    }).catch((notificationError) => {
      console.error("Unable to create waiting-list notification centre item:", {
        waitingListId: waitingRow.id,
        gameId: waitingRow.game_id,
        userId: waitingRow.user_id,
        error: notificationError,
      });
    });

    try {
      await sendWaitingListSpotAvailableEmail({
        notificationId: notification.id,
        waitingListId: waitingRow.id,
        userId: waitingRow.user_id,
        gameId: waitingRow.game_id,
        playerName: waitingRow.player_name,
      });
    } catch (emailError) {
      console.error("Unable to send waiting-list spot available email:", {
        notificationId: notification.id,
        waitingListId: waitingRow.id,
        gameId: waitingRow.game_id,
        userId: waitingRow.user_id,
        error: emailError,
      });
    }
  }

  return { notifiedCount };
}
