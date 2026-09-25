import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { runReferralVerificationReconciliation } from "@/lib/referralRewards";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { GOOGLE_REFERRAL_INTENT_COOKIE } from "@/lib/referralGoogleIntent";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCookie(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const entry = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GOOGLE_REFERRAL_INTENT_COOKIE}=`));

  return entry ? entry.slice(GOOGLE_REFERRAL_INTENT_COOKIE.length + 1) : null;
}

function clearCookie() {
  return `${GOOGLE_REFERRAL_INTENT_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

export async function POST(request: Request) {
  let user;

  try {
    user = await getAuthenticatedUser(request.headers.get("authorization"));
  } catch (error) {
    console.error("Unable to authenticate Google referral intent:", error);
    return Response.json(
      { error: "Unable to complete the referral sign-up." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const intentId = readCookie(request);
  if (!intentId) {
    return Response.json(
      { processed: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!uuidPattern.test(intentId)) {
    return Response.json(
      { processed: false },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearCookie(),
        },
      }
    );
  }

  try {
    assertSupabaseAdminConfigured();
    const { data, error } = await supabaseAdmin.rpc(
      "consume_google_referral_signup_intent",
      {
        p_intent_id: intentId,
        p_referred_user_id: user.id,
      }
    );

    if (error) {
      throw error;
    }

    if (data === true && user.email_confirmed_at) {
      try {
        await runReferralVerificationReconciliation();
      } catch (error) {
        console.error("Unable to reconcile Google referral verification:", error);
      }
    }

    return Response.json(
      { processed: data === true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearCookie(),
        },
      }
    );
  } catch (error) {
    console.error("Unable to consume Google referral intent:", error);
    return Response.json(
      { error: "Unable to complete the referral sign-up." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
