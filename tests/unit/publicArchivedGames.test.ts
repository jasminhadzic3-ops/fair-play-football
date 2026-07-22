import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

describe("public archived game visibility", () => {
  it("excludes archived games from the public game list query", () => {
    expect(homePageSource).toContain('.eq("status", "active")');
    expect(homePageSource).toContain('.is("archived_at", null)');
  });
});
