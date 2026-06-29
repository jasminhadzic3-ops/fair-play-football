import { NextRequest } from "next/server";
import { runPostBookingActions } from "@/lib/postBookingActions";
import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bookGameWithWallet } from "@/lib/wallet";

type WalletBookingPayload = {
  gameId?: unknown;
  playerName?: unknown;
};

type GameData = {
  id: number;
  title: string | null;
  price: number | null;
};

type ProfileData = {
  email: string | null;
  username: string | null;
};

function parsePositiveInteger(value: unknown) {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizePlayerNameForKey(playerName: string) {
  return playerName.trim().toLowerCase().replace(/\s+/g, " ");
}

function getStatusForWalletReason(reason: string | null) {
  switch (reason) {
    case "insufficient_balance":
      return 402;
    case "game_full":
    case "existing_booking":
    case "idempotency_key_conflict":
      return 409;
    case "game_not_found":
      return 404;
    case "invalid_user":
    case "invalid_game":
    case "invalid_player_name":
    case "invalid_amount":
    case "missing_idempotency_key":
      return 400;
    default:
      return 500;
  }
}

function getMessageForWalletReason(reason: string | null) {
  switch (reason) {
    case "insufficient_balance":
      return "Insufficient wallet balance.";
    case "game_full":
      return "This game is already full.";
    case "existing_booking":
      return "You have already joined this game.";
    case "idempotency_key_conflict":
      return "This wallet booking request conflicts with an existing transaction.";
    case "game_not_found":
      return "Game not found.";
    default:
      return "Unable to complete wallet booking.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email_confirmed_at && !user.confirmed_at) {
      return Response.json(
        { error: "Please verify your email before making a payment." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as WalletBookingPayload | null;
    const gameId = parsePositiveInteger(body?.gameId);

    if (!gameId) {
      return Response.json({ error: "Missing game." }, { status: 400 });
    }

    const [{ data: game, error: gameError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabaseAdmin
          .from("games")
          .select("id,title,price")
          .eq("id", gameId)
          .maybeSingle<GameData>(),
        supabaseAdmin
          .from("profiles")
          .select("email,username")
          .eq("id", user.id)
          .maybeSingle<ProfileData>(),
      ]);

    if (gameError) {
      return Response.json({ error: gameError.message }, { status: 500 });
    }

    if (profileError) {
      return Response.json({ error: profileError.message }, { status: 500 });
    }

    if (!game) {
      return Response.json({ error: "Game not found." }, { status: 404 });
    }

    const amount = Number(game.price);

    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Invalid game price." }, { status: 400 });
    }

    const requestPlayerName =
      typeof body?.playerName === "string" ? body.playerName.trim() : "";
    const playerName =
      requestPlayerName ||
      profile?.username?.trim() ||
      profile?.email?.trim() ||
      user.email?.trim() ||
      "Player";
    const normalizedPlayerName = normalizePlayerNameForKey(playerName);
    const idempotencyKey = `wallet_booking_payment:game:${gameId}:user:${user.id}:player:${normalizedPlayerName}`;
    const result = await bookGameWithWallet({
      userId: user.id,
      gameId,
      playerName,
      amount,
      currency: "GBP",
      idempotencyKey,
      metadata: {
        source: "wallet_booking_api",
        game_title: game.title,
      },
    });

    if (!result.success) {
      return Response.json(
        {
          error: getMessageForWalletReason(result.reason),
          reason: result.reason,
          booking_id: result.bookingId,
          wallet_transaction_id: result.walletTransactionId,
          balance: result.balance,
        },
        { status: getStatusForWalletReason(result.reason) }
      );
    }

    if (!result.bookingId || !result.walletTransactionId) {
      console.error("Wallet booking completed without required records:", result);
      return Response.json(
        { error: "Wallet booking completed without required records." },
        { status: 500 }
      );
    }

    await runPostBookingActions({
      bookingId: result.bookingId,
      userId: user.id,
      gameId,
      playerName,
    });

    return Response.json({
      booking_id: result.bookingId,
      wallet_transaction_id: result.walletTransactionId,
      payment_status: "paid",
      payment_method: "wallet",
      balance: result.balance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete wallet booking.";

    console.error("Unable to complete wallet booking:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
