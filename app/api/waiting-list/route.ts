import { NextRequest } from "next/server";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

type WaitingListPayload = {
  game_id?: unknown;
  player_name?: unknown;
};

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
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

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email_confirmed_at && !user.confirmed_at) {
      return Response.json(
        { error: "Please verify your email before joining the waiting list." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as WaitingListPayload | null;
    const gameId = parsePositiveInteger(body?.game_id);
    const playerName = typeof body?.player_name === "string" ? body.player_name.trim() : "";

    if (!gameId || !playerName) {
      return Response.json({ error: "Missing game or player name." }, { status: 400 });
    }

    const { data: game, error: gameError } = await supabaseAdmin
      .from("games")
      .select("id,max_players")
      .eq("id", gameId)
      .maybeSingle();

    if (gameError) {
      return Response.json({ error: gameError.message }, { status: 500 });
    }

    if (!game) {
      return Response.json({ error: "Game not found." }, { status: 404 });
    }

    const { count: bookingCount, error: bookingCountError } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);

    if (bookingCountError) {
      return Response.json({ error: bookingCountError.message }, { status: 500 });
    }

    if ((bookingCount ?? 0) < game.max_players) {
      return Response.json(
        { error: "This game still has spaces. Please book normally." },
        { status: 409 }
      );
    }

    const { data: existingBooking, error: existingBookingError } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .maybeSingle();

    if (existingBookingError) {
      return Response.json({ error: existingBookingError.message }, { status: 500 });
    }

    if (existingBooking) {
      return Response.json({ error: "You are already booked for this game." }, { status: 409 });
    }

    const { data: existingWaitingListRow, error: existingWaitingListError } = await supabaseAdmin
      .from("waiting_list")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .eq("status", "waiting")
      .maybeSingle();

    if (existingWaitingListError) {
      return Response.json({ error: existingWaitingListError.message }, { status: 500 });
    }

    if (existingWaitingListRow) {
      return Response.json({
        waiting_list_entry: existingWaitingListRow,
        message: "You are already on the waiting list.",
      });
    }

    const { data: waitingListEntry, error: insertError } = await supabaseAdmin
      .from("waiting_list")
      .insert({
        game_id: gameId,
        user_id: user.id,
        player_name: playerName,
      })
      .select("id,game_id,user_id,player_name,status,created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return Response.json({
          message: "You are already on the waiting list.",
        });
      }

      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ waiting_list_entry: waitingListEntry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join waiting list.";
    return Response.json({ error: message }, { status: 500 });
  }
}
