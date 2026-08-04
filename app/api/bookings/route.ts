import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

type BookingRow = {
  id: number;
  game_id: number;
  player_name: string;
  user_id: string | null;
};

async function getAuthenticatedUserId(authHeader: string | null) {
  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user.id;
}

export async function GET(request: Request) {
  try {
    assertSupabaseAdminConfigured();
    const currentUserId = await getAuthenticatedUserId(request.headers.get("authorization"));

    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from("bookings")
      .select("id,game_id,player_name,user_id")
      .order("id", { ascending: true });

    if (bookingsError) {
      return Response.json({ error: bookingsError.message }, { status: 500 });
    }

    const bookingRows = (bookings ?? []) as BookingRow[];

    return Response.json({
      bookings: bookingRows.map((booking) => ({
        id: booking.id,
        game_id: booking.game_id,
        player_name: booking.player_name,
        is_current_user: Boolean(currentUserId && booking.user_id === currentUserId),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load bookings.";
    return Response.json({ error: message }, { status: 500 });
  }
}
