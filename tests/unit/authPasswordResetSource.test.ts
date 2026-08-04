import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeClientSource = readFileSync(
  join(process.cwd(), "components/home/HomeClient.tsx"),
  "utf8"
);
const gameDetailsSource = readFileSync(
  join(process.cwd(), "components/games/GameDetails.tsx"),
  "utf8"
);
const resetPasswordSource = readFileSync(
  join(process.cwd(), "app/reset-password/page.tsx"),
  "utf8"
);

describe("password reset source", () => {
  it("offers password reset requests from both sign-in surfaces", () => {
    [homeClientSource, gameDetailsSource].forEach((source) => {
      expect(source).toContain("resetPasswordForEmail");
      expect(source).toContain('redirectTo: `${window.location.origin}/reset-password`');
      expect(source).toContain("Enter your email to reset your password.");
      expect(source).toContain(
        "If an account exists for this email, we will send a secure reset link."
      );
      expect(source).toContain("Forgot password?");
    });
  });

  it("keeps reset request responses generic to avoid account enumeration", () => {
    [homeClientSource, gameDetailsSource].forEach((source) => {
      expect(source).toContain("If an account exists for this email");
      expect(source).not.toContain("No account exists");
      expect(source).not.toContain("Email not found");
    });
  });

  it("validates reset sessions before allowing password updates", () => {
    expect(resetPasswordSource).toContain("access_token");
    expect(resetPasswordSource).toContain("refresh_token");
    expect(resetPasswordSource).toContain("type");
    expect(resetPasswordSource).toContain("recovery");
    expect(resetPasswordSource).toContain("supabase.auth.setSession");
    expect(resetPasswordSource).toContain("supabase.auth.exchangeCodeForSession");
    expect(resetPasswordSource).toContain('throw new Error(invalidResetLinkMessage)');
    expect(resetPasswordSource).toContain("This reset link is invalid or has expired.");
  });

  it("updates the password only from a validated reset session", () => {
    expect(resetPasswordSource).toContain('if (status !== "ready")');
    expect(resetPasswordSource).toContain("supabase.auth.updateUser({ password: newPassword })");
    expect(resetPasswordSource).toContain("await supabase.auth.signOut()");
    expect(resetPasswordSource).toContain("Password updated. Sign in with your new password.");
  });

  it("guards weak or mismatched replacement passwords in the reset form", () => {
    expect(resetPasswordSource).toContain("newPassword.length < 8");
    expect(resetPasswordSource).toContain("Use at least 8 characters for your new password.");
    expect(resetPasswordSource).toContain("newPassword !== confirmPassword");
    expect(resetPasswordSource).toContain("Passwords do not match.");
  });
});
