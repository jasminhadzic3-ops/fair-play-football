import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGREEMENT_VERSION, SIGNUP_AGREEMENT_LABEL } from "@/lib/signupAgreement";

const homePageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const gameDetailsSource = readFileSync(
  join(process.cwd(), "components/games/GameDetails.tsx"),
  "utf8"
);
const profilePageSource = readFileSync(join(process.cwd(), "app/profile/page.tsx"), "utf8");
const baseSchemaSql = readFileSync(join(process.cwd(), "supabase/base_schema.sql"), "utf8");
const agreementSql = readFileSync(join(process.cwd(), "supabase/signup_agreement.sql"), "utf8");

describe("signup agreement source", () => {
  it("uses one shared agreement version and label", () => {
    expect(AGREEMENT_VERSION).toBe("2026-07-27");
    expect(SIGNUP_AGREEMENT_LABEL).toBe(
      "I agree to the Terms of Service and Privacy Policy and understand that Fair Play Football will email me important updates about my account, bookings, payments, match reminders, cancellations, waiting-list updates and future football games."
    );
    expect(homePageSource).toContain("AGREEMENT_VERSION");
    expect(gameDetailsSource).toContain("AGREEMENT_VERSION");
  });

  it("renders one required agreement checkbox on each signup surface with safe legal links", () => {
    [homePageSource, gameDetailsSource].forEach((source) => {
      expect(source).toContain('type="checkbox"');
      expect(source).toContain("aria-label={SIGNUP_AGREEMENT_LABEL}");
      expect(source).toContain("required");
      expect(source).toContain('href="/terms"');
      expect(source).toContain('href="/privacy"');
      expect(source).toContain('target="_blank"');
      expect(source).toContain('rel="noopener noreferrer"');
    });
  });

  it("guards email signup and Google signup initiated from signup mode", () => {
    [homePageSource, gameDetailsSource].forEach((source) => {
      expect(source).toContain("Please accept the Terms of Service and Privacy Policy to create an account.");
    });

    expect(homePageSource).toContain('navbarAuthMode === "signup"');
    expect(gameDetailsSource).toContain('authMode === "signup"');
    expect(homePageSource).toContain("!navbarAgreementAccepted");
    expect(gameDetailsSource).toContain("!agreementAccepted");
  });

  it("persists agreement acceptance through pending storage, auth metadata, and profile upserts", () => {
    [homePageSource, gameDetailsSource, profilePageSource].forEach((source) => {
      expect(source).toContain("terms_accepted_at");
      expect(source).toContain("terms_version");
    });

    expect(homePageSource).toContain("localStorage.setItem(PENDING_SIGNUP_PROFILE_KEY");
    expect(gameDetailsSource).toContain("localStorage.setItem(");
    expect(profilePageSource).toContain("pendingProfile.terms_accepted_at");
    expect(profilePageSource).toContain("userMetadata.terms_accepted_at");
  });

  it("keeps existing users compatible by allowing nullable agreement fields", () => {
    expect(agreementSql).toContain("add column if not exists terms_accepted_at timestamptz");
    expect(agreementSql).toContain("add column if not exists terms_version text");
    expect(baseSchemaSql).toContain("terms_accepted_at timestamptz");
    expect(baseSchemaSql).toContain("terms_version text");
    expect(agreementSql).not.toMatch(/not null/i);
  });
});
