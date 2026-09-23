import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const homeSource = readFileSync(resolve(repoRoot, "components/home/HomeClient.tsx"), "utf8");
const gameDetailsSource = readFileSync(resolve(repoRoot, "components/games/GameDetails.tsx"), "utf8");
const profileSource = readFileSync(resolve(repoRoot, "app/profile/page.tsx"), "utf8");
const verificationSource = readFileSync(resolve(repoRoot, "app/verify-email/page.tsx"), "utf8");
const confirmationSource = readFileSync(resolve(repoRoot, "app/auth/confirm/page.tsx"), "utf8");
const referralSource = readFileSync(resolve(repoRoot, "lib/referralSignup.ts"), "utf8");

describe("signup and onboarding source flow", () => {
  it("moves both email signup surfaces to the fixed confirmation destination", () => {
    for (const source of [homeSource, gameDetailsSource]) {
      expect(source).toContain("getEmailConfirmationRedirectUrl(window.location.origin)");
      expect(source).toContain("window.location.assign(getEmailVerificationPath())");
      expect(source).toContain('onboarding_source: "email"');
      expect(source).not.toContain('emailRedirectTo: `${window.location.origin}/profile?complete_profile=1`');
    }
  });

  it("presents the locked referral message in the verification journey", () => {
    expect(referralSource).toContain("Referral code applied. Verify your email to complete your referral.");
    expect(verificationSource).toContain("REFERRAL_PENDING_VERIFICATION_MESSAGE");
    expect(verificationSource).toContain("referral_signup_intent_id");
  });

  it("handles hash and PKCE confirmation links before profile onboarding", () => {
    expect(confirmationSource).toContain("supabase.auth.setSession");
    expect(confirmationSource).toContain("supabase.auth.exchangeCodeForSession(code)");
    expect(confirmationSource).toContain('getProfileOnboardingPath("verified")');
    expect(confirmationSource).toContain("clearConfirmationUrl()");
  });

  it("preserves server guards by handing unverified game actions to verification before requests", () => {
    expect(gameDetailsSource).toContain('openEmailVerification("booking")');
    expect(gameDetailsSource).toContain('openEmailVerification("wallet")');
    expect(gameDetailsSource).toContain('openEmailVerification("waiting-list")');
    expect(gameDetailsSource).toContain("window.location.assign(getEmailVerificationPath(intent))");
  });

  it("completes pending signup details on Profile without forcing established players into onboarding", () => {
    expect(profileSource).toContain('onboardingSource === "verified"');
    expect(profileSource).toContain('onboardingSource === "profile"');
    expect(profileSource).toContain("hasRequiredPlayerDetails(completedProfile)");
    expect(profileSource).toContain("requestReferralVerificationReconciliation()");
    expect(profileSource).toContain('url.searchParams.delete("onboarding")');
  });
});