import { NextRequest } from "next/server";
import { finalizeCheckoutPayment } from "@/lib/sumupPayments";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const checkoutId = payload?.id || payload?.checkout_id;

  if (!checkoutId) {
    return new Response(null, { status: 204 });
  }

  try {
    await finalizeCheckoutPayment(checkoutId);
  } catch (error) {
    console.error("Unable to process SumUp webhook:", error);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
