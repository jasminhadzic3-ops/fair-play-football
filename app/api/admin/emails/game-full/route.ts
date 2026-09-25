import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { sendGameFullEmails } from "@/lib/email/gameFull";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GameFullPayload = {
  gameId?: unknown;
};

function parseGameId(body: GameFullPayload | null) {
  if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "gameId")) {
    return null;
  }

  const gameId = body.gameId;

  return typeof gameId === "number" && Number.isInteger(gameId) && gameId > 0 ? gameId : null;
}

export async function POST(request: NextRequest) {
  const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

  if (!adminUser) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as GameFullPayload | null;
  const gameId = parseGameId(body);

  if (!gameId) {
    return Response.json(
      { success: false, error: "A valid gameId is required." },
      { status: 400 }
    );
  }

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id,status,archived_at,max_players")
    .eq("id", gameId)
    .maybeSingle();

  if (gameError) {
    console.error("Unable to load game for Game On catch-up:", { gameId, error: gameError });
    return Response.json({ success: false, error: "Unable to verify game status." }, { status: 500 });
  }

  if (!game) {
    return Response.json({ success: false, error: "Game not found." }, { status: 404 });
  }

  const maxPlayers = Number(game.max_players ?? 0);

  if (game.status !== "active" || game.archived_at || !maxPlayers) {
    return Response.json({ success: false, error: "Game is not active." }, { status: 409 });
  }

  const { count: activeBookingCount, error: bookingCountError } = await supabaseAdmin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);

  if (bookingCountError) {
    console.error("Unable to count bookings for Game On catch-up:", { gameId, error: bookingCountError });
    return Response.json({ success: false, error: "Unable to verify game capacity." }, { status: 500 });
  }

  if ((activeBookingCount ?? 0) !== maxPlayers) {
    return Response.json(
      { success: false, error: "Game is not full." },
      { status: 409 }
    );
  }

  try {
    const result = await sendGameFullEmails({ gameId });

    return Response.json({
      success: true,
      gameId,
      activeBookingCount: activeBookingCount ?? 0,
      maxPlayers,
      ...result,
    });
  } catch (error) {
    console.error("Unable to send Game On catch-up:", { gameId, error });
    return Response.json({ success: false, error: "Unable to send Game On email." }, { status: 500 });
  }
}
