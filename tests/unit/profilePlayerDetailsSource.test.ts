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
  });

  it("does not render an empty movement profile", () => {
    expect(profileSource).toContain("profile?.accelerate_type || accelerateType ?");
    expect(profileSource).toContain("Movement profile");
  });

  it("supports pinned desktop and touch player details with keyboard/outside close", () => {
    expect(teamListSource).toContain("Player details");
    expect(teamListSource).toContain('role="dialog"');
    expect(teamListSource).toContain('event.key === "Escape"');
    expect(teamListSource).toContain('document.addEventListener("pointerdown"');
    expect(teamListSource).toContain("aria-expanded");
  });
});
