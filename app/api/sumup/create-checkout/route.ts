import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { createSumUpCheckout, getAuthenticatedUser } from "@/lib/sumupPayments";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const requiredEnvVars = [
  "SUMUP_API_KEY",
  "SUMUP_MERCHANT_CODE",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUMUP_CURRENCY",
];

function getMissingEnvVars() {
  return requiredEnvVars.filter((name) => !process.env[name]);
}

export async function POST(request: NextRequest) {
  try {
    const missingEnvVars = getMissingEnvVars();

    if (missingEnvVars.length > 0) {
      return Response.json(
        { error: `Missing required server env vars: ${missingEnvVars.join(", ")}` },
        { status: 500 }
      );
    }

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

    const body = await request.json().catch(() => null);
    const { gameId, playerName } = body ?? {};

    if (!gameId || !playerName?.trim()) {
      return Response.json({ error: "Missing game or player name." }, { status: 400 });
    }

    const { data: game, error: gameError } = await supabaseAdmin
      .from("games")
      .select("id,title,location,time,price")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return Response.json({ error: "Game not found." }, { status: 404 });
    }

    const { data: existingBooking } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .eq("player_name", playerName.trim())
      .maybeSingle();

    if (existingBooking) {
      return Response.json({ error: "You have already joined this game." }, { status: 409 });
    }

    const checkoutReference = randomUUID();
    const redirectUrl = `${request.nextUrl.origin}/?sumup_checkout_reference=${checkoutReference}`;
    const checkout = await createSumUpCheckout({
      amount: Number(game.price ?? 0),
      checkoutReference,
      description: `${game.title} booking for ${playerName.trim()}`,
      redirectUrl,
      webhookUrl: `${request.nextUrl.origin}/api/sumup/webhook`,
    });

    if (!checkout.id || !checkout.hosted_checkout_url) {
      return Response.json({ error: "SumUp did not return a hosted checkout URL." }, { status: 502 });
    }

    const { error: paymentError } = await supabaseAdmin.from("booking_payments").insert({
      user_id: user.id,
      game_id: gameId,
      player_name: playerName.trim(),
      checkout_id: checkout.id,
      checkout_reference: checkoutReference,
      hosted_checkout_url: checkout.hosted_checkout_url,
      payment_status: "pending",
      amount: Number(game.price ?? 0),
      currency: process.env.SUMUP_CURRENCY || "GBP",
      raw_checkout: checkout,
    });

    if (paymentError) {
      console.error("Unable to store pending SumUp payment:", paymentError);
      return Response.json({ error: paymentError.message }, { status: 500 });
    }

    return Response.json({
      checkout_id: checkout.id,
      checkout_reference: checkoutReference,
      hosted_checkout_url: checkout.hosted_checkout_url,
      payment_status: "pending",
    });
  } catch (error: any) {
    console.error("Unable to create SumUp checkout:", error);
    return Response.json(
      { error: error?.message || "Unable to create SumUp checkout." },
      { status: 500 }
    );
  }
}
