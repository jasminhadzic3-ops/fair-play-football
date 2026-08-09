import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { sendNewGamePostedEmails } from "@/lib/email/newGamePosted";
import { parseLondonKickoff } from "@/lib/londonKickoff";
import { parseGameTags } from "@/lib/gameTags";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GamePayload = {
  title?: unknown;
  location?: unknown;
  kickoff_date?: unknown;
  kickoff_time?: unknown;
  price?: unknown;
  max_players?: unknown;
  tags?: unknown;
};

function parseGamePayload(body: GamePayload | null) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const kickoff = parseLondonKickoff(body?.kickoff_date, body?.kickoff_time);
  const price = Number(body?.price);
  const maxPlayers = Number(body?.max_players);
  const tags = parseGameTags(body?.tags);

  if (
    !title ||
    !location ||
    !kickoff ||
    Number.isNaN(price) ||
    Number.isNaN(maxPlayers) ||
    ![12, 14, 16].includes(maxPlayers) ||
    !tags
  ) {
    return null;
  }

  return {
    title,
    location,
    time: kickoff.displayTime,
    starts_at: kickoff.startsAtIso,
    price,
    max_players: maxPlayers,
    tags,
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
        { error: "Please fill in all fields with a valid London kickoff date and time. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8), with up to 5 valid tags." },
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
