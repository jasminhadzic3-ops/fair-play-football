import { NextRequest } from "next/server";
import { runLoyaltyRewardsReconciliation } from "@/lib/loyaltyRewards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  return Boolean(cronSecret && authorization === `Bearer ${cronSecret}`);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runLoyaltyRewardsReconciliation();

    return Response.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Unable to reconcile loyalty rewards:", error);
    return Response.json(
      { error: "Unable to reconcile loyalty rewards." },
      { status: 500 }
    );
  }
}
