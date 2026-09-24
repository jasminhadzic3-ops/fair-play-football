import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations/20260924130000_add_google_referral_signup_acceptance.sql"),
  "utf8"
).toLowerCase();
const route = readFileSync(
  resolve(repoRoot, "app/api/referrals/google-intent/consume/route.ts"),
  "utf8"
).toLowerCase();
const cookieRoute = readFileSync(
  resolve(repoRoot, "app/api/referrals/google-intent/route.ts"),
  "utf8"
).toLowerCase();

describe("Google referral signup acceptance", () => {
  it("uses a locked, service-role-only security-definer RPC", () => {
    expect(migration).toContain("consume_google_referral_signup_intent");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("for update");
    expect(migration).toContain("grant execute on function public.consume_google_referral_signup_intent(uuid, uuid)");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("revoke all on function public.consume_google_referral_signup_intent(uuid, uuid)");
  });

  it("proves a genuinely new Google account without trusting client state", () => {
    expect(migration).toContain("v_user.created_at <= v_intent.created_at");
    expect(migration).toContain("auth.identities");
    expect(migration).toContain("google_identity.provider = 'google'");
    expect(migration).toContain("existing_relationship.referred_user_id = v_user.id");
    expect(migration).toContain("v_intent.referrer_user_id = v_user.id");
    expect(migration).not.toContain("last_sign_in_at");
    expect(migration).not.toContain("wallet_transactions");
    expect(migration).toContain("on conflict (referred_user_id) do nothing");
  });

  it("preserves the normal pending referral lifecycle and consumes the intent atomically", () => {
    expect(migration).toContain("referrer-reward:' || v_user.id::text");
    expect(migration).toContain("referred-reward-unlock:' || v_user.id::text");
    expect(migration).toContain("consumed_by_user_id = v_user.id");
    expect(migration).toContain("return true");
    expect(migration).toContain("return false");
  });

  it("keeps the browser cookie opaque and server-authenticated", () => {
    expect(cookieRoute).toContain("httponly");
    expect(cookieRoute).toContain("samesite=lax");
    expect(cookieRoute).toContain("max-age=900");
    expect(route).toContain("getauthenticateduser");
    expect(route).toContain("p_referred_user_id: user.id");
    expect(route).toContain("p_intent_id: intentid");
    expect(route).not.toContain("request.json");
    expect(route).toContain("set-cookie");
  });
});
