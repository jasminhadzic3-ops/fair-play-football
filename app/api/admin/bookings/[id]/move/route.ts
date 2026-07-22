import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyWaitingListForOpenSpace } from "@/lib/waitingListNotifications";

type MoveBookingResult = {
  success: boolean;
  booking_id: number | null;
  source_game_id: number | null;
  target_game_id: number | null;
  reason: string | null;
  source_was_full_before_move: boolean;
  source_has_space_after_move: boolean;
};

type MoveBookingPayload = {
  target_game_id?: unknown;
};

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function getMoveBookingErrorMessage(reason: string | null) {
  switch (reason) {
    case "same_game":
      return "This booking is already in the selected game.";
    case "target_game_not_found":
      return "Target game not found.";
    case "target_game_cancelled":
      return "Bookings cannot be moved into a cancelled game.";
    case "target_game_not_active":
      return "Bookings can only be moved into active games.";
    case "target_game_missing_starts_at":
      return "Bookings can only be moved into active future games with a structured kickoff time.";
    case "target_game_past":
      return "Bookings cannot be moved into past games.";
    case "target_game_full":
      return "Target game is full.";
    case "booking_has_cancellation_history":
      return "This booking cannot be moved because it already has cancellation credit history.";
    case "booking_has_refund_history":
      return "This booking cannot be moved because it already has refund history.";
    case "booking_has_ambiguous_payment_history":
      return "This booking has ambiguous payment history and cannot be moved automatically. Review its payment records first.";
    case "booking_missing_game":
      return "This booking is not linked to a valid source game.";
    case "booking_not_found":
      return "Booking not found.";
    case "invalid_booking":
    case "invalid_target_game":
      return "Invalid booking move request.";
    default:
      return "Unable to move booking.";
  }
}

function getMoveBookingStatus(reason: string | null) {
  switch (reason) {
    case "booking_not_found":
      return 404;
    case "invalid_booking":
    case "invalid_target_game":
      return 400;
    default:
      return 409;
  }
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

    const { data, error } = await supabaseAdmin
      .rpc("move_booking_if_space", {
        p_booking_id: bookingId,
        p_target_game_id: targetGameId,
      })
      .single<MoveBookingResult>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!data?.success) {
      return Response.json(
        { error: getMoveBookingErrorMessage(data?.reason ?? null), reason: data?.reason ?? null },
        { status: getMoveBookingStatus(data?.reason ?? null) }
      );
    }

    if (data.source_game_id && data.source_was_full_before_move && data.source_has_space_after_move) {
      await notifyWaitingListForOpenSpace(data.source_game_id).catch((notificationError) => {
        console.warn("Unable to notify waiting list after moving booking:", notificationError);
      });
    }

    return Response.json({
      ok: true,
      booking: {
        id: data.booking_id,
        game_id: data.target_game_id,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to move booking.";
    return Response.json({ error: message }, { status: 500 });
  }
}
