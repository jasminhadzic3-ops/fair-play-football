import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const home = readFileSync(resolve(repoRoot, "components/home/HomeClient.tsx"), "utf8");
const details = readFileSync(resolve(repoRoot, "components/games/GameDetails.tsx"), "utf8");

describe("email referral signup UI", () => {
  it("provides the optional field and friendly validation wording in both email signup flows", () => {
    for (const source of [home, details]) {
      expect(source).toContain("Referral code");
      expect(source).not.toContain("Referral &amp; Promo Codes");
      expect(source).not.toContain("Referral code (optional)");
      expect(source).toContain("border-amber-200/20");
      expect(source).toContain("focus:border-amber-200/70");
      expect(source).toContain("Enter referral code");
      expect(source).toMatch(/referralStatus\} ✓|navbarReferralStatus\} ✓/);
      expect(source).not.toContain("Enter your referral code here");
      expect(source).toContain("text-amber-100");
      expect(source).toContain("REFERRAL_APPLIED_MESSAGE");
      expect(source).toContain("REFERRAL_INVALID_MESSAGE");
      expect(source).toContain("createReferralSignupIntent");
      expect(source).toContain("referral_signup_intent_id");
    }
  });

  it("keeps Google OAuth free of referral metadata while preserving the opaque intent separately", () => {
    for (const source of [home, details]) {
      expect(source).toContain('supabase.auth.signInWithOAuth({');
      expect(source).toContain('provider: "google"');
      expect(source).toContain('prompt: "select_account"');
      expect(source).toContain("storeGoogleReferralIntent");
      expect(source).toContain("referral_signup_intent_id");
      expect(source).not.toContain("referrer_user_id");
    }
  });
});
