import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { getBookingActionLifecycleBlock } from "@/lib/bookingActionLifecycle";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

function parseBookingId(id: string) {
  const bookingId = Number(id);

  return Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null;
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
    const bookingId = parseBookingId(id);

    if (!bookingId) {
      return Response.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id,game_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      return Response.json({ error: bookingError.message }, { status: 500 });
    }

    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    const { data: sourceGame, error: sourceGameError } = await supabaseAdmin
      .from("games")
      .select("id,max_players,status,starts_at,archived_at")
      .eq("id", booking.game_id)
      .maybeSingle();

    if (sourceGameError) {
      return Response.json({ error: sourceGameError.message }, { status: 500 });
    }

    const lifecycleBlock = getBookingActionLifecycleBlock(sourceGame);

    if (lifecycleBlock) {
      return Response.json(
        { error: lifecycleBlock.message, reason: lifecycleBlock.reason },
        { status: lifecycleBlock.status }
      );
    }

    const { count: bookingCountBeforeRemove, error: countBeforeError } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("game_id", booking.game_id);

    if (countBeforeError) {
      return Response.json({ error: countBeforeError.message }, { status: 500 });
    }

    const wasFullBeforeRemove =
      sourceGame ? (bookingCountBeforeRemove ?? 0) >= sourceGame.max_players : false;

    const { error } = await supabaseAdmin.from("bookings").delete().eq("id", bookingId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (sourceGame && wasFullBeforeRemove) {
      const { count: bookingCountAfterRemove, error: countAfterError } = await supabaseAdmin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("game_id", booking.game_id);

      if (countAfterError) {
        return Response.json({ error: countAfterError.message }, { status: 500 });
      }

      if ((bookingCountAfterRemove ?? 0) < sourceGame.max_players) {
        await notifyWaitingListForOpenSpace(booking.game_id).catch((notificationError) => {
          console.warn("Unable to notify waiting list after removing booking:", notificationError);
        });
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove booking.";
    return Response.json({ error: message }, { status: 500 });
  }
}
