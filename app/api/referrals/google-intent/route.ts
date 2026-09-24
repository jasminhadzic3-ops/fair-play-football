import { GOOGLE_REFERRAL_INTENT_COOKIE } from "@/lib/referralGoogleIntent";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cookieHeader(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GOOGLE_REFERRAL_INTENT_COOKIE}=${value}; Max-Age=900; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearedCookieHeader() {
  return `${GOOGLE_REFERRAL_INTENT_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const intentId = typeof body?.intent_id === "string" ? body.intent_id.trim() : "";

  if (!uuidPattern.test(intentId)) {
    return Response.json({ error: "Invalid referral intent." }, { status: 400 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": cookieHeader(intentId),
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE() {
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearedCookieHeader(),
      "Cache-Control": "no-store",
    },
  });
}
