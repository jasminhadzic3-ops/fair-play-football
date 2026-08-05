import { NextRequest } from "next/server";
import { getAuthenticatedNotificationUser } from "@/lib/notificationAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type NotificationPatchBody = {
  action?: unknown;
};

function parseNotificationId(id: string) {
  const notificationId = Number(id);

  return Number.isInteger(notificationId) && notificationId > 0 ? notificationId : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedNotificationUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const notificationId = parseNotificationId(id);

    if (!notificationId) {
      return Response.json({ error: "Invalid notification id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as NotificationPatchBody | null;
    const action = body?.action;

    if (action !== "mark_read" && action !== "archive") {
      return Response.json({ error: "Invalid notification action." }, { status: 400 });
    }

    const updates =
      action === "archive"
        ? { archived_at: new Date().toISOString(), read_at: new Date().toISOString() }
        : { read_at: new Date().toISOString() };

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update(updates)
      .eq("id", notificationId)
      .eq("user_id", user.id)
      .select("id,read_at,archived_at")
      .maybeSingle<{ id: number; read_at: string | null; archived_at: string | null }>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return Response.json({ error: "Notification not found." }, { status: 404 });
    }

    return Response.json({ notification: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update notification.";

    return Response.json({ error: message }, { status: 500 });
  }
}
