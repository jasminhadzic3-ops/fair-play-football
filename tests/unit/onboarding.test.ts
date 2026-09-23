import { describe, expect, it } from "vitest";
import {
  getEmailConfirmationRedirectUrl,
  getEmailVerificationPath,
  getProfileOnboardingPath,
  hasRequiredPlayerDetails,
  isEmailVerified,
} from "@/lib/onboarding";

describe("onboarding helpers", () => {
  it("recognises only confirmed email users as verified", () => {
    expect(isEmailVerified(null)).toBe(false);
    expect(isEmailVerified({ email_confirmed_at: null, confirmed_at: null })).toBe(false);
    expect(isEmailVerified({ email_confirmed_at: "2026-09-23T12:00:00.000Z" })).toBe(true);
    expect(isEmailVerified({ confirmed_at: "2026-09-23T12:00:00.000Z" })).toBe(true);
  });

  it("requires an age and favourite position before a new player is complete", () => {
    expect(hasRequiredPlayerDetails(null)).toBe(false);
    expect(hasRequiredPlayerDetails({ age: "20", favourite_position: null })).toBe(false);
    expect(hasRequiredPlayerDetails({ age: null, favourite_position: "Midfielder" })).toBe(false);
    expect(hasRequiredPlayerDetails({ age: "20", favourite_position: "Midfielder" })).toBe(true);
  });

  it("uses fixed internal paths for confirmation and handoffs", () => {
    expect(getEmailConfirmationRedirectUrl("https://www.fairplayfootball.co.uk/")).toBe(
      "https://www.fairplayfootball.co.uk/auth/confirm"
    );
    expect(getEmailConfirmationRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/confirm"
    );
    expect(getEmailVerificationPath()).toBe("/verify-email");
    expect(getEmailVerificationPath("booking")).toBe("/verify-email?intent=booking");
    expect(getProfileOnboardingPath("verified")).toBe("/profile?onboarding=verified");
  });
});