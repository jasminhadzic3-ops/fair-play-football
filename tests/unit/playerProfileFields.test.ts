import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCELERATE_DESCRIPTIONS,
  ACCELERATE_OPTIONS,
  FOOT_RATING_VALUES,
  PLAYER_POSITION_OPTIONS,
  PREFERRED_FOOT_OPTIONS,
  isAccelerateType,
  isFootRating,
  isPreferredFoot,
  formatFootRating,
} from "@/lib/playerProfile";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260925130000_upgrade_player_profile_fields.sql"),
  "utf8"
);
const footRatingsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260925140000_add_player_foot_ratings.sql"),
  "utf8"
);

describe("premium player profile fields", () => {
  it("keeps new fields optional and constrained by the forward migration", () => {
    expect(migration).toContain("add column if not exists secondary_position text");
    expect(migration).toContain("add column if not exists preferred_foot text");
    expect(migration).toContain("add column if not exists accelerate_type text");
    expect(migration).toContain("profiles_preferred_foot_check");
    expect(migration).toContain("profiles_accelerate_type_check");
    expect(migration).toContain("profiles_secondary_position_distinct_check");
  });

  it("supports exactly the approved optional values", () => {
    expect(PREFERRED_FOOT_OPTIONS).toEqual(["Left", "Right", "Both"]);
    expect(PLAYER_POSITION_OPTIONS).toContain("Winger");
    expect(ACCELERATE_OPTIONS).toHaveLength(7);
    expect(Object.keys(ACCELERATE_DESCRIPTIONS)).toEqual([...ACCELERATE_OPTIONS]);
    expect(isPreferredFoot("Right")).toBe(true);
    expect(isPreferredFoot("Either")).toBe(false);
    expect(isAccelerateType("Mostly Lengthy")).toBe(true);
    expect(isAccelerateType("Fast")).toBe(false);
  });

  it("constrains both optional foot ratings to one through five", () => {
    expect(FOOT_RATING_VALUES).toEqual([1, 2, 3, 4, 5]);
    expect(footRatingsMigration).toContain("add column if not exists left_foot_rating integer");
    expect(footRatingsMigration).toContain("add column if not exists right_foot_rating integer");
    expect(footRatingsMigration).toContain("profiles_left_foot_rating_check");
    expect(footRatingsMigration).toContain("profiles_right_foot_rating_check");
    expect(isFootRating(1)).toBe(true);
    expect(isFootRating(5)).toBe(true);
    expect(isFootRating(0)).toBe(false);
    expect(isFootRating(6)).toBe(false);
    expect(isFootRating(null)).toBe(false);
    expect(formatFootRating(3)).toBe("★★★☆☆");
    expect(formatFootRating(null)).toBe("N/A");
  });
});
