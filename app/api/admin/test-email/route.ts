import { NextRequest } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminAuth";
import { sendResendEmail } from "@/lib/email/resend";

type TestEmailPayload = {
  recipient_email?: unknown;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipientEmail(body: TestEmailPayload | null) {
  const email = typeof body?.recipient_email === "string" ? body.recipient_email.trim() : "";

  return emailPattern.test(email) ? email : null;
}

export async function POST(request: NextRequest) {
  const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

  if (!adminUser) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as TestEmailPayload | null;
  const recipientEmail = parseRecipientEmail(body);

  if (!recipientEmail) {
    return Response.json(
      { success: false, error: "A valid recipient email is required." },
      { status: 400 }
    );
  }

  try {
    await sendResendEmail({
      to: recipientEmail,
      subject: "Fair Play Football - Email Test",
      html: `
        <p>Fair Play Football email delivery is working.</p>
        <p>This is a one-off admin test email.</p>
      `,
      text: [
        "Fair Play Football email delivery is working.",
        "",
        "This is a one-off admin test email.",
      ].join("\n"),
      idempotencyKey: `admin_test_email:${adminUser.id}:${Date.now()}`,
    });

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send test email.";

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
