import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

type BookingRow = {
  id: number;
  game_id: number;
  player_name: string;
  user_id: string | null;
};

type ProfileAvatarRow = {
  id: string;
  avatar_url: string | null;
};

export async function GET() {
  try {
    assertSupabaseAdminConfigured();

    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from("bookings")
      .select("id,game_id,player_name,user_id")
      .order("id", { ascending: true });

    if (bookingsError) {
      return Response.json({ error: bookingsError.message }, { status: 500 });
    }

    const bookingRows = (bookings ?? []) as BookingRow[];
    const userIds = Array.from(
      new Set(
        bookingRows
          .map((booking) => booking.user_id)
          .filter((userId): userId is string => Boolean(userId))
      )
    );
    let avatarByUserId = new Map<string, string | null>();

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id,avatar_url")
        .in("id", userIds);

      if (profilesError) {
        return Response.json({ error: profilesError.message }, { status: 500 });
      }

      avatarByUserId = new Map(
        ((profiles ?? []) as ProfileAvatarRow[]).map((profile) => [
          profile.id,
          profile.avatar_url,
        ])
      );
    }

    return Response.json({
      bookings: bookingRows.map((booking) => ({
        id: booking.id,
        game_id: booking.game_id,
        player_name: booking.player_name,
        user_id: booking.user_id,
        avatar_url: booking.user_id ? avatarByUserId.get(booking.user_id) ?? null : null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load bookings.";
    return Response.json({ error: message }, { status: 500 });
  }
}
