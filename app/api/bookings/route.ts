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
    const bookedUserIds = currentUserId
      ? Array.from(
          new Set(
            bookingRows
              .map((booking) => booking.user_id)
              .filter((userId): userId is string => Boolean(userId))
          )
        )
      : [];

    let avatarUrlByUserId = new Map<string, string | null>();

    if (bookedUserIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id,avatar_url")
        .in("id", bookedUserIds);

      if (profilesError) {
        console.warn("Unable to load player avatars:", profilesError.message);
      } else {
        avatarUrlByUserId = new Map(
          ((profiles ?? []) as ProfileAvatarRow[]).map((profile) => [
            profile.id,
            profile.avatar_url,
          ])
        );
      }
    }

    return Response.json({
      bookings: bookingRows.map((booking) => ({
        id: booking.id,
        game_id: booking.game_id,
        player_name: booking.player_name,
        is_current_user: Boolean(currentUserId && booking.user_id === currentUserId),
        ...(currentUserId
          ? { avatar_url: booking.user_id ? avatarUrlByUserId.get(booking.user_id) ?? null : null }
          : {}),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load bookings.";
    return Response.json({ error: message }, { status: 500 });
  }
}
