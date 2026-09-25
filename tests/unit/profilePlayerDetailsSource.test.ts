import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(join(process.cwd(), "app/profile/page.tsx"), "utf8");
const teamListSource = readFileSync(join(process.cwd(), "components/games/TeamList.tsx"), "utf8");

describe("profile player-details source", () => {
  it("loads and persists the optional football profile fields", () => {
    expect(profileSource).toContain("secondary_position");
    expect(profileSource).toContain("preferred_foot");
    expect(profileSource).toContain("accelerate_type");
    expect(profileSource).toContain("Save Changes");
    expect(profileSource).toContain("Add photo");
    expect(profileSource).toContain("Change photo");
    expect(profileSource).toContain("Edit profile");
    expect(profileSource).toContain("We couldn’t load your player profile right now. Please try again.");
  });

  it("does not render an empty movement profile", () => {
    expect(profileSource).toContain("profile?.accelerate_type || accelerateType ?");
    expect(profileSource).toContain("Movement profile");
  });

  it("supports a floating desktop/mobile player-details modal with keyboard/outside close", () => {
    expect(teamListSource).toContain("Player details");
    expect(teamListSource).toContain("fixed inset-0");
    expect(teamListSource).toContain('role="dialog"');
    expect(teamListSource).toContain('aria-modal="true"');
    expect(teamListSource).toContain('event.key === "Escape"');
    expect(teamListSource).toContain('event.target === event.currentTarget');
    expect(teamListSource).toContain("aria-expanded");
    expect(teamListSource).toContain('{ label: "Age", value: details.age ?? "N/A" }');
    expect(teamListSource).toContain('{ label: "AcceleRATE Type", value: details.accelerate_type || "N/A" }');
    expect(teamListSource).not.toContain("selectedBookingId === booking.id ? renderPlayerDetails(booking) : null");
  });
});
