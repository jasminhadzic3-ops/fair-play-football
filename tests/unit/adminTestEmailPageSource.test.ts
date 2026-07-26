import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/admin/test-email/page.tsx"), "utf8");

describe("admin test email page source", () => {
  it("checks admin access before showing the form", () => {
    expect(source).toContain('fetch("/api/admin/me"');
    expect(source).toContain("setIsAdmin(response.ok && result?.isAdmin === true)");
    expect(source).toContain("You must be signed in as an admin to send a test email.");
  });

  it("defaults to Jasmin and posts to the admin test email endpoint with the current session", () => {
    expect(source).toContain('useState("jasminhadzic3@gmail.com")');
    expect(source).toContain('fetch("/api/admin/test-email"');
    expect(source).toContain("Authorization: `Bearer ${session.access_token}`");
    expect(source).toContain("body: JSON.stringify({ recipient_email: recipientEmail })");
  });

  it("shows sending, success and error states", () => {
    expect(source).toContain("isSubmitting ? \"Sending...\" : \"Send Test Email\"");
    expect(source).toContain("Test email sent successfully.");
    expect(source).toContain("setError(sendError instanceof Error ? sendError.message");
  });
});
