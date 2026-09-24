export const GOOGLE_REFERRAL_INTENT_COOKIE = "fair_play_google_referral_intent";

export async function storeGoogleReferralIntent(intentId: string) {
  const response = await fetch("/api/referrals/google-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent_id: intentId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to preserve the referral code for Google sign-up.");
  }
}

export async function clearGoogleReferralIntent() {
  await fetch("/api/referrals/google-intent", {
    method: "DELETE",
    cache: "no-store",
  }).catch(() => undefined);
}

export async function consumeGoogleReferralIntent(accessToken: string) {
  const response = await fetch("/api/referrals/google-intent/consume", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to complete the referral sign-up.");
  }

  return (await response.json().catch(() => null)) as { processed?: boolean } | null;
}
