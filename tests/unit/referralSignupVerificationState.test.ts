import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const signupSource = readFileSync(resolve(repoRoot, "components/games/GameDetails.tsx"), "utf8");
const referralSource = readFileSync(resolve(repoRoot, "lib/referralSignup.ts"), "utf8");
const verificationSource = readFileSync(resolve(repoRoot, "app/verify-email/page.tsx"), "utf8");

describe("referral signup verification state", () => {
  it("shows the informational message only after a referral intent and unverified signup", () => {
    expect(referralSource).toContain(
      '"Referral code applied. Verify your email to complete your referral."'
    );
    expect(signupSource).toContain("referralIntentId");
    expect(verificationSource).toContain("REFERRAL_PENDING_VERIFICATION_MESSAGE");
    expect(verificationSource).toContain("referral_signup_intent_id");
  });

  it("preserves invalid referral errors and normal no-referral signup messaging", () => {
    expect(referralSource).toContain("REFERRAL_SIGNUP_ERROR_MESSAGE");
    expect(signupSource).toContain("referralCode.trim()");
    expect(signupSource).toContain("getEmailVerificationPath()");
    expect(signupSource).toContain("REFERRAL_INVALID_MESSAGE");
  });
});
