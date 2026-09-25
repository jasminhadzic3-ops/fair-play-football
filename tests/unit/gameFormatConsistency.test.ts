import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFormatFromMaxPlayers } from "@/lib/gameUtils";
import {
  getGameFormatTag,
  getGameFormatMaxPlayers,
  hasMatchingGameFormatTag,
  synchronizeGameFormatTag,
} from "@/lib/gameTags";

describe("game format and capacity consistency", () => {
  it("maps each supported a-side tag to its total capacity and displayed format", () => {
    expect(getGameFormatMaxPlayers(["6-a-side"])).toBe(12);
    expect(getGameFormatMaxPlayers(["7-a-side"])).toBe(14);
    expect(getGameFormatMaxPlayers(["8-a-side"])).toBe(16);
    expect(getFormatFromMaxPlayers(12)).toBe("6v6");
    expect(getFormatFromMaxPlayers(14)).toBe("7v7");
    expect(getFormatFromMaxPlayers(16)).toBe("8v8");
  });

  it("rejects tags that disagree with capacity while leaving availability based on capacity", () => {
    expect(hasMatchingGameFormatTag(["8-a-side"], 14)).toBe(false);
    expect(hasMatchingGameFormatTag(["8-a-side"], 16)).toBe(true);
    expect(hasMatchingGameFormatTag(["6-a-side", "8-a-side"], 16)).toBe(false);
    const gameCardSource = readFileSync(
      join(process.cwd(), "components/games/GameCard.tsx"),
      "utf8"
    );
    expect(gameCardSource).toContain("const spotsLeft = maxPlayers - confirmedPlayers;");
    expect(gameCardSource).toContain("getFormatFromMaxPlayers(maxPlayers)");
    expect(readFileSync(join(process.cwd(), "components/games/GameDetails.tsx"), "utf8")).toContain("{gameFormat} format");
  });

  it("keeps the canonical format tag aligned when capacity changes", () => {
    expect(getGameFormatTag(12)).toBe("6-a-side");
    expect(getGameFormatTag(14)).toBe("7-a-side");
    expect(getGameFormatTag(16)).toBe("8-a-side");
    expect(synchronizeGameFormatTag(["8-a-side", "Casual"], 14)).toEqual(["7-a-side", "Casual"]);
    expect(synchronizeGameFormatTag(["Casual", "Outdoor"], 16)).toEqual(["Casual", "Outdoor"]);

    const adminSource = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
    const editRouteSource = readFileSync(join(process.cwd(), "app/api/admin/games/[id]/route.ts"), "utf8");
    expect(adminSource).toContain("synchronizeGameFormatTag(selectedTags, numericMaxPlayers)");
    expect(adminSource).toContain("tags: synchronizedTags");
    expect(editRouteSource).toContain("Capacity cannot be reduced below");
    expect(editRouteSource).toContain('hasMatchingGameFormatTag(tags, maxPlayers)');
  });
});
