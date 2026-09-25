import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../../app/admin/page.tsx"), "utf8");

describe("Admin Game On action", () => {
  it("gates the action to active full games and requires confirmation", () => {
    expect(source).toContain('game.status !== "active"');
    expect(source).toContain("activeBookingCount !== game.max_players");
    expect(source).toContain("Send the Game On email to all currently booked players for this full game?");
    expect(source).toContain("Send Game On");
  });

  it("uses the authenticated admin request pattern and the game id", () => {
    expect(source).toContain('fetch("/api/admin/emails/game-full"');
    expect(source).toContain("headers: await getAdminAuthHeaders()");
    expect(source).toContain("body: JSON.stringify({ gameId: game.id })");
    expect(source).toContain("Game On email processed successfully.");
  });

  it("does not add client-side email or secret handling", () => {
    expect(source).not.toContain("RESEND_API_KEY");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("sendResendEmail");
  });
});
