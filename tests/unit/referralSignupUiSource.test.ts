import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const home = readFileSync(resolve(repoRoot, "components/home/HomeClient.tsx"), "utf8");
const details = readFileSync(resolve(repoRoot, "components/games/GameDetails.tsx"), "utf8");

describe("email referral signup UI", () => {
  it("provides the optional field and friendly validation wording in both email signup flows", () => {
    for (const source of [home, details]) {
      expect(source).toContain("Referral code (optional)");
      expect(source).toContain("REFERRAL_APPLIED_MESSAGE");
      expect(source).toContain("REFERRAL_INVALID_MESSAGE");
      expect(source).toContain("createReferralSignupIntent");
      expect(source).toContain("referral_signup_intent_id");
    }
  });

  it("leaves the existing Google OAuth calls unchanged and does not pass referral metadata to them", () => {
    for (const source of [home, details]) {
      expect(source).toContain('supabase.auth.signInWithOAuth({');
      expect(source).toContain('provider: "google"');
      expect(source).toContain('prompt: "select_account"');
    }
  });
});
