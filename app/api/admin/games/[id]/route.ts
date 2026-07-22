import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import {
  cancelGameWithWalletCredits,
  GameCancellationError,
  retryGameCancellationEmails,
} from "@/lib/gameCancellation";
import { parseLondonKickoff } from "@/lib/londonKickoff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GamePayload = {
  action?: unknown;
  cancellation_reason?: unknown;
  title?: unknown;
  location?: unknown;
  time?: unknown;
  kickoff_date?: unknown;
  kickoff_time?: unknown;
  price?: unknown;
  max_players?: unknown;
};

function parseGamePayload(body: GamePayload | null) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const legacyTime = typeof body?.time === "string" ? body.time.trim() : "";
  const hasKickoffDate = typeof body?.kickoff_date === "string" && body.kickoff_date.trim() !== "";
  const hasKickoffTime = typeof body?.kickoff_time === "string" && body.kickoff_time.trim() !== "";
  const hasStructuredKickoff = hasKickoffDate || hasKickoffTime;
  const kickoff = hasStructuredKickoff
    ? parseLondonKickoff(body?.kickoff_date, body?.kickoff_time)
    : null;
  const price = Number(body?.price);
  const maxPlayers = Number(body?.max_players);

  if (
    !title ||
    !location ||
    (hasStructuredKickoff ? !kickoff : !legacyTime) ||
    Number.isNaN(price) ||
    Number.isNaN(maxPlayers) ||
    ![12, 14, 16].includes(maxPlayers)
  ) {
    return null;
  }

  return {
    title,
    location,
    time: kickoff?.displayTime ?? legacyTime,
    ...(kickoff ? { starts_at: kickoff.startsAtIso } : {}),
    price,
    max_players: maxPlayers,
  };
}

function parseGameId(id: string) {
  const gameId = Number(id);

  return Number.isInteger(gameId) && gameId > 0 ? gameId : null;
}

function isCancelGamePayload(body: GamePayload | null): body is GamePayload {
  return body?.action === "cancel";
}

function isRetryCancellationEmailsPayload(body: GamePayload | null): body is GamePayload {
  return body?.action === "retry_cancellation_emails";
}

function parseCancellationReason(body: GamePayload | null) {
  return typeof body?.cancellation_reason === "string" ? body.cancellation_reason.trim() || null : null;
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
    const gameId = parseGameId(id);

    if (!gameId) {
      return Response.json({ error: "Invalid game id." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);

    if (isCancelGamePayload(body)) {
      const result = await cancelGameWithWalletCredits({
        gameId,
        adminUserId: adminUser.id,
        cancellationReason: parseCancellationReason(body),
      });

      return Response.json(result);
    }

    if (isRetryCancellationEmailsPayload(body)) {
      const emailWarning = await retryGameCancellationEmails({ gameId });

      return Response.json({
        ok: true,
        ...(emailWarning ? { email_warning: emailWarning } : {}),
      });
    }

    const payload = parseGamePayload(body);

    if (!payload) {
      return Response.json(
        { error: "Please fill in all fields with a valid London kickoff date and time. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8)." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("games")
      .update(payload)
      .eq("id", gameId)
      .select("*")
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ game: data });
  } catch (error) {
    if (error instanceof GameCancellationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unable to update game.";
    return Response.json({ error: message }, { status: 500 });
  }
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
    const gameId = parseGameId(id);

    if (!gameId) {
      return Response.json({ error: "Invalid game id." }, { status: 400 });
    }

    const [{ count: bookingCount, error: bookingCountError }, { count: paymentCount, error: paymentCountError }] =
      await Promise.all([
        supabaseAdmin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("game_id", gameId),
        supabaseAdmin
          .from("booking_payments")
          .select("id", { count: "exact", head: true })
          .eq("game_id", gameId),
      ]);

    if (bookingCountError || paymentCountError) {
      return Response.json(
        { error: bookingCountError?.message || paymentCountError?.message || "Unable to check game records." },
        { status: 500 }
      );
    }

    if ((bookingCount ?? 0) > 0 || (paymentCount ?? 0) > 0) {
      return Response.json(
        {
          error:
            "This game cannot be deleted because it has bookings or payment records. Cancel/refund or reconcile the game first, then delete it.",
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin.from("games").delete().eq("id", gameId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete game.";
    return Response.json({ error: message }, { status: 500 });
  }
}
