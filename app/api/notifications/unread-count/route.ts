import { NextRequest } from "next/server";
import { getAuthenticatedNotificationUser } from "@/lib/notificationAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedNotificationUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { count, error } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .is("archived_at", null);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ unread_count: count ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load notification count.";

    return Response.json({ error: message }, { status: 500 });
  }
}
