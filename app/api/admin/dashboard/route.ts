import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Payment = {
  payment_status: string | null;
};

function countPaymentsByStatus(payments: Payment[]) {
  return payments.reduce<Record<string, number>>((counts, payment) => {
    const status = payment.payment_status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [gamesResult, bookingsResult, profilesResult, paymentsResult] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id,title,location,time,price,max_players")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("bookings")
        .select("id,game_id,user_id,player_name")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("profiles")
        .select("id,email,username,age,gender,favourite_position"),
      supabaseAdmin
        .from("booking_payments")
        .select(
          "id,user_id,game_id,player_name,checkout_id,checkout_reference,payment_status,booking_id,hosted_checkout_url,amount,currency,raw_checkout,created_at,updated_at"
        )
        .order("created_at", { ascending: false }),
    ]);

    const firstError =
      gamesResult.error ||
      bookingsResult.error ||
      profilesResult.error ||
      paymentsResult.error;

    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    const games = gamesResult.data ?? [];
    const bookings = bookingsResult.data ?? [];
    const profiles = profilesResult.data ?? [];
    const bookingPayments = paymentsResult.data ?? [];

    return Response.json({
      games,
      bookings,
      profiles,
      booking_payments: bookingPayments,
      summary: {
        games_count: games.length,
        bookings_count: bookings.length,
        profiles_count: profiles.length,
        payments_count: bookingPayments.length,
        payments_by_status: countPaymentsByStatus(bookingPayments),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin dashboard.";
    return Response.json({ error: message }, { status: 500 });
  }
}
