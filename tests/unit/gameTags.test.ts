import { describe, expect, it } from "vitest";
import { GAME_TAG_OPTIONS, MAX_GAME_TAGS, getGameTags, parseGameTags } from "@/lib/gameTags";

describe("game tags", () => {
  it("accepts no tags or up to five unique catalogue tags", () => {
    expect(parseGameTags(undefined)).toEqual([]);
    expect(parseGameTags([])).toEqual([]);
    expect(parseGameTags(GAME_TAG_OPTIONS.slice(0, MAX_GAME_TAGS))).toEqual(
      GAME_TAG_OPTIONS.slice(0, MAX_GAME_TAGS)
    );
  });

  it("rejects too many, duplicate, unknown, or malformed tags", () => {
    expect(parseGameTags(GAME_TAG_OPTIONS.slice(0, MAX_GAME_TAGS + 1))).toBeNull();
    expect(parseGameTags(["Casual", "Casual"])).toBeNull();
    expect(parseGameTags(["Casual", "Unknown"])).toBeNull();
    expect(parseGameTags("Casual")).toBeNull();
  });

  it("returns a safe empty display list for invalid stored data", () => {
    expect(getGameTags(null)).toEqual([]);
    expect(getGameTags(["Unknown"])).toEqual([]);
  });
});
