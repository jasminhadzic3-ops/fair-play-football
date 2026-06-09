import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MoveBookingPayload = {
  target_game_id?: unknown;
};

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
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
    const bookingId = parsePositiveInteger(id);

    if (!bookingId) {
      return Response.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as MoveBookingPayload | null;
    const targetGameId = parsePositiveInteger(body?.target_game_id);

    if (!targetGameId) {
      return Response.json({ error: "Invalid target game id." }, { status: 400 });
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

    const { data: targetGame, error: targetGameError } = await supabaseAdmin
      .from("games")
      .select("id,max_players")
      .eq("id", targetGameId)
      .maybeSingle();

    if (targetGameError) {
      return Response.json({ error: targetGameError.message }, { status: 500 });
    }

    if (!targetGame) {
      return Response.json({ error: "Target game not found." }, { status: 404 });
    }

    if (booking.game_id === targetGameId) {
      return Response.json({ ok: true, booking });
    }

    const { count: targetBookingCount, error: countError } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("game_id", targetGameId);

    if (countError) {
      return Response.json({ error: countError.message }, { status: 500 });
    }

    if ((targetBookingCount ?? 0) >= targetGame.max_players) {
      return Response.json({ error: "Target game is full." }, { status: 409 });
    }

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({ game_id: targetGameId })
      .eq("id", bookingId)
      .select("id,game_id")
      .single();

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    return Response.json({ ok: true, booking: updatedBooking });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to move booking.";
    return Response.json({ error: message }, { status: 500 });
  }
}
