import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const attendanceStatuses = new Set(["attended", "no_show"]);

type AttendanceResult = {
  booking_id: number;
  game_id: number;
  user_id: string | null;
  status: "attended" | "no_show";
  marked_by: string;
  marked_at: string;
  updated_at: string;
  correction_note: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const bookingId = Number(body?.booking_id);
    const status = typeof body?.status === "string" ? body.status : "";
    const correctionReason = typeof body?.correction_reason === "string" ? body.correction_reason.trim() : "";

    if (!Number.isInteger(bookingId) || bookingId <= 0 || !attendanceStatuses.has(status)) {
      return Response.json({ error: "Choose Attended or No-show." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .rpc("admin_set_booking_attendance", {
        p_booking_id: bookingId,
        p_status: status,
        p_marked_by: adminUser.id,
        p_correction_reason: correctionReason || null,
      })
      .single<AttendanceResult>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ attendance: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save attendance.";
    return Response.json({ error: message }, { status: 500 });
  }
}
