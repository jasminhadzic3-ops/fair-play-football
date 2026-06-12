import { assertSupabaseAdminConfigured, supabaseAdmin } from "./supabaseAdmin";

const openSpaceMessage =
  "A space may be available for this game. Book now to try for the spot. Spots are first paid, first served.";

type WaitingListRow = {
  id: number;
  game_id: number;
  user_id: string;
  player_name: string;
};

export async function notifyWaitingListForOpenSpace(gameId: number) {
  assertSupabaseAdminConfigured();

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
    const { error } = await supabaseAdmin.from("waiting_list_notifications").insert({
      waiting_list_id: waitingRow.id,
      game_id: waitingRow.game_id,
      user_id: waitingRow.user_id,
      player_name: waitingRow.player_name,
      status: "unread",
      message: openSpaceMessage,
    });

    if (error) {
      if (error.code === "23505") {
        continue;
      }

      throw error;
    }

    notifiedCount += 1;
  }

  return { notifiedCount };
}
