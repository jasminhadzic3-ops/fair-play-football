import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function parseBookingId(id: string) {
  const bookingId = Number(id);

  return Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    if (!adminUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const bookingId = parseBookingId(id);

    if (!bookingId) {
      return Response.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      return Response.json({ error: bookingError.message }, { status: 500 });
    }

    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    const { error } = await supabaseAdmin.from("bookings").delete().eq("id", bookingId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove booking.";
    return Response.json({ error: message }, { status: 500 });
  }
}
