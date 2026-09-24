import { NextRequest } from "next/server";

import { AUTH_MESSAGES } from "@/lib/authMessages";
import { runPostBookingActions } from "@/lib/postBookingActions";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type FreeBookingPayload = { gameId?: unknown };

function parseGameId(value: unknown) {
  const gameId = Number(value);
  return Number.isInteger(gameId) && gameId > 0 ? gameId : null;
}

function statusForReason(reason: string | null) {
  switch (reason) {
    case "game_not_found":
      return 404;
    case "game_not_free":
    case "game_full":
    case "game_cancelled":
    case "game_archived":
    case "game_not_bookable":
    case "game_completed":
      return 409;
    default:
      return 400;
  }
}

function messageForReason(reason: string | null) {
  switch (reason) {
    case "game_not_found": return "Game not found.";
    case "game_not_free": return "This game is not available as a free booking.";
    case "game_full": return "This game is already full.";
    case "game_cancelled": return "This game has been cancelled and is no longer available for booking.";
    case "game_archived": return "This game has been archived and is no longer available for booking.";
    case "game_not_bookable":
    case "game_completed": return "This game is no longer available for booking.";
    default: return "Unable to join this free game.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (!user.email_confirmed_at && !user.confirmed_at) {
      return Response.json({ error: AUTH_MESSAGES.verifyAccountBeforeBooking }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as FreeBookingPayload | null;
    const gameId = parseGameId(body?.gameId);
    if (!gameId) return Response.json({ error: "Missing game." }, { status: 400 });

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email,username")
      .eq("id", user.id)
      .maybeSingle<{ email: string | null; username: string | null }>();
    if (profileError) return Response.json({ error: profileError.message }, { status: 500 });

    const playerName = profile?.username?.trim() || profile?.email?.trim() || user.email?.trim() || "Player";
    const { data, error } = await supabaseAdmin.rpc("create_free_booking_if_space", {
      p_user_id: user.id,
      p_game_id: gameId,
      p_player_name: playerName,
    });
    if (error) {
      console.error("Unable to create free booking:", error);
      return Response.json({ error: "Unable to join this free game." }, { status: 500 });
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      success: boolean; booking_id: number | null; created: boolean; reason: string | null;
    } | null;
    if (!result?.success || !result.booking_id) {
      return Response.json({ error: messageForReason(result?.reason ?? null), reason: result?.reason ?? null }, { status: statusForReason(result?.reason ?? null) });
    }

    if (result.created) {
      await runPostBookingActions({
        bookingId: result.booking_id,
        userId: user.id,
        gameId,
        playerName,
        bookingConfirmation: { paymentId: null, paymentMethod: "free", amount: 0, currency: "GBP" },
      });
    }

    return Response.json({ booking_id: result.booking_id, created: result.created, payment_status: "free", payment_method: "free" }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error("Unable to create free booking:", error);
    return Response.json({ error: "Unable to join this free game." }, { status: 500 });
  }
}
