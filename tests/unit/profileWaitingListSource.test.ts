import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(join(process.cwd(), "app/profile/page.tsx"), "utf8");

describe("profile waiting-list notifications source", () => {
  it("loads lifecycle fields and validates notification book-now links before redirecting", () => {
    expect(profileSource).toContain('import { isBookable } from "@/lib/gameLifecycle"');
    expect(profileSource).toContain("status?: string | null");
    expect(profileSource).toContain("starts_at?: string | null");
    expect(profileSource).toContain("archived_at?: string | null");
    expect(profileSource).toContain(".select(\"id,title,location,time,max_players,status,starts_at,archived_at\")");
    expect(profileSource).toContain(".select(\"id,max_players,status,starts_at,archived_at\")");
    expect(profileSource).toContain("if (!isBookable(game, { bookingCount: bookingCount ?? 0 }))");
    expect(profileSource).toContain("window.location.href = `/?open_game_id=");
  });
});
