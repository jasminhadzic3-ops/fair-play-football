import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFormatFromMaxPlayers } from "@/lib/gameUtils";
import {
  getGameFormatMaxPlayers,
  hasMatchingGameFormatTag,
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
  });
});
