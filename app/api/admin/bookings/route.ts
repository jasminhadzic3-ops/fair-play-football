import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AddAdminBookingResult = {
  success: boolean;
  booking_id: number | null;
  reason: string | null;
};

const paymentMethods = new Set(["website", "cash", "free", "manual"]);

function getErrorMessage(reason: string | null) {
  switch (reason) {
    case "already_booked":
      return "This player is already booked into the game.";
    case "game_full":
      return "This game is already full.";
    case "game_not_found":
      return "Game not found.";
    case "game_unavailable":
      return "Players cannot be added to a cancelled or archived game.";
    default:
      return "Unable to add this player to the game.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const gameId = Number(body?.game_id);
    const playerType = body?.player_type === "guest" ? "guest" : "existing";
    const userId = playerType === "existing" && typeof body?.user_id === "string" ? body.user_id : null;
    const playerName = typeof body?.player_name === "string" ? body.player_name.trim() : "";
    const paymentMethod = typeof body?.payment_method === "string" ? body.payment_method : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    const phoneNumber = typeof body?.phone_number === "string" ? body.phone_number.trim() : "";

    if (
      !Number.isInteger(gameId) ||
      gameId <= 0 ||
      !playerName ||
      !paymentMethods.has(paymentMethod) ||
      (playerType === "existing" && !userId) ||
      (playerType === "guest" && paymentMethod === "website")
    ) {
      return Response.json({ error: "Please complete all required player details." }, { status: 400 });
    }

    const bookingSource =
      playerType === "guest"
        ? "guest"
        : paymentMethod === "website"
          ? "website"
          : paymentMethod === "cash"
            ? "cash"
            : "manual";

    const { data, error } = await supabaseAdmin
      .rpc("add_admin_game_booking", {
        p_game_id: gameId,
        p_user_id: userId,
        p_player_name: playerName,
        p_payment_method: paymentMethod,
        p_booking_source: bookingSource,
        p_added_by: "admin",
        p_notes: notes || null,
        p_guest_phone: playerType === "guest" ? phoneNumber || null : null,
        p_created_by: adminUser.id,
      })
      .single<AddAdminBookingResult>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!data?.success || !data.booking_id) {
      return Response.json(
        { error: getErrorMessage(data?.reason ?? null), reason: data?.reason ?? null },
        { status: data?.reason === "game_not_found" ? 404 : data?.reason === "game_full" ? 409 : 400 }
      );
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id,game_id,user_id,player_name")
      .eq("id", data.booking_id)
      .single();

    if (bookingError) {
      return Response.json({ error: bookingError.message }, { status: 500 });
    }

    return Response.json({
      booking: {
        ...booking,
        payment_method: paymentMethod,
        booking_source: bookingSource,
        added_by: "admin",
        notes: notes || null,
        guest_phone: playerType === "guest" ? phoneNumber || null : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add this player.";
    return Response.json({ error: message }, { status: 500 });
  }
}
