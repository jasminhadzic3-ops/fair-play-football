import { NextRequest } from "next/server";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

function parseBookingId(id: string) {
  const bookingId = Number(id);

  return Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null;
}

async function getAuthenticatedUser(authHeader: string | null) {
  assertSupabaseAdminConfigured();

  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const bookingId = parseBookingId(id);

    if (!bookingId) {
      return Response.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id,game_id,user_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      return Response.json({ error: bookingError.message }, { status: 500 });
    }

    if (!booking || booking.user_id !== user.id) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    const { data: game, error: gameError } = await supabaseAdmin
      .from("games")
      .select("id,max_players")
      .eq("id", booking.game_id)
      .maybeSingle();

    if (gameError) {
      return Response.json({ error: gameError.message }, { status: 500 });
    }

    const { count: bookingCountBeforeRemove, error: countBeforeError } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("game_id", booking.game_id);

    if (countBeforeError) {
      return Response.json({ error: countBeforeError.message }, { status: 500 });
    }

    const wasFullBeforeRemove =
      game ? (bookingCountBeforeRemove ?? 0) >= game.max_players : false;

    const { data: deletedBooking, error: deleteError } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("id", bookingId)
      .eq("user_id", user.id)
      .select("id")
      .single();

    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }

    if (!deletedBooking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    if (game && wasFullBeforeRemove) {
      const { count: bookingCountAfterRemove, error: countAfterError } = await supabaseAdmin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("game_id", booking.game_id);

      if (countAfterError) {
        return Response.json({ error: countAfterError.message }, { status: 500 });
      }

      if ((bookingCountAfterRemove ?? 0) < game.max_players) {
        await notifyWaitingListForOpenSpace(booking.game_id).catch((notificationError) => {
          console.warn("Unable to notify waiting list after player left booking:", notificationError);
        });
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to leave booking.";
    return Response.json({ error: message }, { status: 500 });
  }
}
