import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { sendNewGamePostedEmails } from "@/lib/email/newGamePosted";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GamePayload = {
  title?: unknown;
  location?: unknown;
  time?: unknown;
  price?: unknown;
  max_players?: unknown;
};

function parseGamePayload(body: GamePayload | null) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const time = typeof body?.time === "string" ? body.time.trim() : "";
  const price = Number(body?.price);
  const maxPlayers = Number(body?.max_players);

  if (
    !title ||
    !location ||
    !time ||
    Number.isNaN(price) ||
    Number.isNaN(maxPlayers) ||
    ![12, 14, 16].includes(maxPlayers)
  ) {
    return null;
  }

  return {
    title,
    location,
    time,
    price,
    max_players: maxPlayers,
  };
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const payload = parseGamePayload(body);

    if (!payload) {
      return Response.json(
        { error: "Please fill in all fields. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8)." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("games")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    await sendNewGamePostedEmails({ gameId: data.id }).catch((emailError) => {
      console.error("Unable to send new game posted email:", {
        gameId: data.id,
        error: emailError,
      });
    });

    return Response.json({ game: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create game.";
    return Response.json({ error: message }, { status: 500 });
  }
}
