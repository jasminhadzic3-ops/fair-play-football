import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Payment = {
  payment_status: string | null;
  amount: number | string | null;
};

type Profile = {
  id: string;
  email: string | null;
  username: string | null;
};

type RefundRequest = {
  id: number;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  description: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string | null;
};

function countPaymentsByStatus(payments: Payment[]) {
  return payments.reduce<Record<string, number>>((counts, payment) => {
    const status = payment.payment_status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function countUniquePlayers(bookings: Array<{ user_id: string | null; player_name: string | null }>) {
  const playerKeys = new Set<string>();

  bookings.forEach((booking) => {
    const key = booking.user_id || booking.player_name?.trim().toLowerCase();

    if (key) {
      playerKeys.add(key);
    }
  });

  return playerKeys.size;
}

function sumPaidPaymentAmounts(payments: Payment[]) {
  return payments
    .filter((payment) => payment.payment_status?.toLowerCase() === "paid")
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [
      gamesResult,
      bookingsResult,
      profilesResult,
      paymentsResult,
      walletTransactionsResult,
      refundRequestsResult,
      waitingListResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id,title,location,time,price,max_players,status,cancelled_at,cancelled_by,cancellation_reason")
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
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,user_id,game_id,booking_id,amount,currency,transaction_type,status,created_at")
        .eq("transaction_type", "wallet_booking_payment")
        .eq("status", "completed")
        .lt("amount", 0)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,user_id,amount,currency,transaction_type,status,description,metadata,created_at")
        .eq("transaction_type", "refund_requested")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("waiting_list")
        .select("id,game_id,user_id,player_name,status,created_at")
        .eq("status", "waiting")
        .order("created_at", { ascending: true }),
    ]);

    const firstError =
      gamesResult.error ||
      bookingsResult.error ||
      profilesResult.error ||
      paymentsResult.error ||
      walletTransactionsResult.error ||
      refundRequestsResult.error ||
      waitingListResult.error;

    if (firstError) {
      return Response.json({ error: firstError.message }, { status: 500 });
    }

    const games = gamesResult.data ?? [];
    const bookings = bookingsResult.data ?? [];
    const profiles = profilesResult.data ?? [];
    const bookingPayments = paymentsResult.data ?? [];
    const walletTransactions = walletTransactionsResult.data ?? [];
    const profileById = new Map((profiles as Profile[]).map((profile) => [profile.id, profile]));
    const refundRequests = ((refundRequestsResult.data ?? []) as RefundRequest[]).map((request) => {
      const profile = request.user_id ? profileById.get(request.user_id) : null;

      return {
        ...request,
        player_name: profile?.username ?? null,
        player_email: profile?.email ?? null,
      };
    });
    const waitingList = waitingListResult.data ?? [];

    return Response.json({
      games,
      bookings,
      profiles,
      booking_payments: bookingPayments,
      wallet_transactions: walletTransactions,
      refund_requests: refundRequests,
      waiting_list: waitingList,
      summary: {
        games_count: games.length,
        bookings_count: bookings.length,
        players_count: countUniquePlayers(bookings),
        profiles_count: profiles.length,
        payments_count: bookingPayments.length,
        waiting_list_count: waitingList.length,
        paid_payments_amount_total: sumPaidPaymentAmounts(bookingPayments),
        payments_by_status: countPaymentsByStatus(bookingPayments),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin dashboard.";
    return Response.json({ error: message }, { status: 500 });
  }
}
