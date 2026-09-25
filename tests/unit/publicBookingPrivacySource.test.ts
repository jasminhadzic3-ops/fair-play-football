import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = {
  gameCalendar: readFileSync(join(process.cwd(), "lib/gameCalendar.ts"), "utf8"),
  gameDetails: readFileSync(join(process.cwd(), "components/games/GameDetails.tsx"), "utf8"),
  gameCard: readFileSync(join(process.cwd(), "components/games/GameCard.tsx"), "utf8"),
  teamList: readFileSync(join(process.cwd(), "components/games/TeamList.tsx"), "utf8"),
  bookingsRoute: readFileSync(join(process.cwd(), "app/api/bookings/route.ts"), "utf8"),
};

describe("public booking privacy source", () => {
  it("uses a public-safe current-user flag instead of raw booking user ids in public UI", () => {
    expect(files.gameCalendar).toContain("is_current_user?: boolean | null");
    expect(files.gameCalendar).toContain("booking.is_current_user === true");
    expect(files.gameDetails).toContain("booking.is_current_user === true");
    expect(files.teamList).toContain("booking.is_current_user === true");
    expect(files.gameDetails).not.toContain("booking.user_id ===");
    expect(files.teamList).not.toContain("booking.user_id ===");
  });

  it("keeps raw user ids server-side while returning only safe roster fields to signed-in viewers", () => {
    expect(files.bookingsRoute).toContain("getAuthenticatedUserId");
    expect(files.bookingsRoute).toContain("is_current_user: Boolean");
    expect(files.bookingsRoute).toContain('select("id,username,avatar_url,favourite_position,secondary_position,preferred_foot,accelerate_type")');
    expect(files.bookingsRoute).not.toContain("user_id: booking.user_id");
    expect(files.bookingsRoute).not.toContain("email:");
    expect(files.bookingsRoute).not.toContain("phone:");
  });

  it("renders optional roster avatars and positions without exposing placeholder profile data", () => {
    expect(files.teamList).toContain("booking.avatar_url");
    expect(files.teamList).toContain("booking.favourite_position");
    expect(files.teamList).toContain("POSITION_SHORT_LABELS");
    expect(files.teamList).toContain("primary_position");
    expect(files.teamList).not.toContain("Position unavailable");
    expect(files.teamList).toContain("getInitials(displayName)");
    expect(files.teamList).toContain("{position ? (");
  });
});
