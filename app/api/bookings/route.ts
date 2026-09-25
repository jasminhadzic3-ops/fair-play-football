import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

type BookingRow = {
  id: number;
  game_id: number;
  player_name: string;
  user_id: string | null;
};

type RosterProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  favourite_position: string | null;
  secondary_position: string | null;
  preferred_foot: string | null;
  accelerate_type: string | null;
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

    let rosterProfileByUserId = new Map<string, RosterProfileRow>();

    if (bookedUserIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id,username,avatar_url,favourite_position,secondary_position,preferred_foot,accelerate_type")
        .in("id", bookedUserIds);

      if (profilesError) {
        console.warn("Unable to load player roster profiles:", profilesError.message);
      } else {
        rosterProfileByUserId = new Map(
          ((profiles ?? []) as RosterProfileRow[]).map((profile) => [profile.id, profile])
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
          ? {
              avatar_url: booking.user_id
                ? rosterProfileByUserId.get(booking.user_id)?.avatar_url ?? null
                : null,
              favourite_position: booking.user_id
                ? rosterProfileByUserId.get(booking.user_id)?.favourite_position ?? null
                : null,
              ...(booking.user_id
                ? {
                    player_details: {
                      display_name: rosterProfileByUserId.get(booking.user_id)?.username?.trim() || booking.player_name,
                      avatar_url: rosterProfileByUserId.get(booking.user_id)?.avatar_url ?? null,
                      primary_position: rosterProfileByUserId.get(booking.user_id)?.favourite_position ?? null,
                      secondary_position: rosterProfileByUserId.get(booking.user_id)?.secondary_position ?? null,
                      preferred_foot: rosterProfileByUserId.get(booking.user_id)?.preferred_foot ?? null,
                      accelerate_type: rosterProfileByUserId.get(booking.user_id)?.accelerate_type ?? null,
                    },
                  }
                : {}),
            }
          : {}),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load bookings.";
    return Response.json({ error: message }, { status: 500 });
  }
}
