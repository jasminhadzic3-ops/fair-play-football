import { getAuthenticatedUser } from "@/lib/sumupPayments";
import { runReferralVerificationReconciliation } from "@/lib/referralRewards";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email_confirmed_at) {
      return Response.json(
        { processed: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    await runReferralVerificationReconciliation();

    return Response.json(
      { processed: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Unable to process referral verification:", error);
    return Response.json(
      { error: "Unable to process referral verification." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
