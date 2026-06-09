import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Booking = {
  id: number;
  game_id: number;
  user_id: string | null;
  player_name: string | null;
};

type Game = {
  id: number;
  title: string | null;
  time: string | null;
  location: string | null;
};

type BookingPayment = {
  booking_id: number | null;
  game_id: number;
  user_id: string | null;
  player_name: string | null;
  payment_status: string | null;
  amount: number | string | null;
  currency: string | null;
};

const csvColumns = [
  "player_name",
  "game_title",
  "game_time",
  "game_location",
  "payment_status",
  "amount",
  "currency",
];

function escapeCsvValue(value: unknown) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  const injectionSafeValue = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;

  return `"${injectionSafeValue.replace(/"/g, '""')}"`;
}

function getPaymentForBooking(booking: Booking, payments: BookingPayment[]) {
  const normalizedPlayerName = booking.player_name?.trim().toLowerCase();

  return (
    payments.find((payment) => payment.booking_id === booking.id) ||
    payments.find(
      (payment) =>
        booking.user_id &&
        payment.user_id === booking.user_id &&
        payment.game_id === booking.game_id
    ) ||
    payments.find(
      (payment) =>
        normalizedPlayerName &&
        payment.game_id === booking.game_id &&
        payment.player_name?.trim().toLowerCase() === normalizedPlayerName
    )
  );
}

function buildBookingsCsv(bookings: Booking[], games: Game[], payments: BookingPayment[]) {
  const rows = bookings.map((booking) => {
    const game = games.find((gameItem) => gameItem.id === booking.game_id);
    const payment = getPaymentForBooking(booking, payments);

    return [
      booking.player_name || "Unnamed player",
      game?.title || "Unknown game",
      game?.time || "",
      game?.location || "",
      payment?.payment_status || "unknown",
      payment?.amount ?? "",
      payment?.currency || "",
    ];
  });

  return [
    csvColumns.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [gamesResult, bookingsResult, paymentsResult] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id,title,time,location")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("bookings")
        .select("id,game_id,user_id,player_name")
        .order("id", { ascending: true }),
      supabaseAdmin
        .from("booking_payments")
        .select("booking_id,game_id,user_id,player_name,payment_status,amount,currency")
        .order("created_at", { ascending: false }),
    ]);

    const firstError = gamesResult.error || bookingsResult.error || paymentsResult.error;

    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    const csv = buildBookingsCsv(
      bookingsResult.data ?? [],
      gamesResult.data ?? [],
      paymentsResult.data ?? []
    );

    return new Response(csv, {
      headers: {
        "Content-Disposition": 'attachment; filename="fair-play-bookings.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export bookings.";
    return Response.json({ error: message }, { status: 500 });
  }
}
