import { NextRequest } from "next/server";
import { getAuthenticatedNotificationUser } from "@/lib/notificationAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const allowedFilters = new Set([
  "all",
  "unread",
  "bookings",
  "games",
  "wallet",
  "refunds",
  "waiting_list",
]);

const categoryFilters = new Set([
  "bookings",
  "games",
  "wallet",
  "refunds",
  "waiting_list",
]);

function parseLimit(value: string | null) {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    return 20;
  }

  return Math.min(limit, 50);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedNotificationUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter") || "all";
    const cursor = searchParams.get("cursor");
    const limit = parseLimit(searchParams.get("limit"));

    if (!allowedFilters.has(filter)) {
      return Response.json({ error: "Invalid notification filter." }, { status: 400 });
    }

    let query = supabaseAdmin
      .from("notifications")
      .select(
        "id,type,category,title,body,icon,action_url,action_label,game_id,booking_id,wallet_transaction_id,refund_request_id,waiting_list_id,read_at,archived_at,created_at"
      )
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (filter === "unread") {
      query = query.is("read_at", null);
    } else if (categoryFilters.has(filter)) {
      query = query.eq("category", filter);
    }

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data, error } = await query;

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const notifications = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? notifications[notifications.length - 1]?.created_at ?? null : null;

    return Response.json({
      notifications,
      next_cursor: nextCursor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load notifications.";

    return Response.json({ error: message }, { status: 500 });
  }
}
