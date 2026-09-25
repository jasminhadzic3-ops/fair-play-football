import { describe, expect, it } from "vitest";

import {
  FAIR_PLAY_WHATSAPP_GROUP_URL,
  formatGameType,
  getCommunityEmailText,
  getFirstName,
  renderCommunityEmailBlocks,
} from "@/lib/email/shared";

describe("shared player email foundation", () => {
  it.each([
    ["Jasmin Hadzic", "Jasmin"],
    ["  Michael Smith  ", "Michael"],
    ["Player", "there"],
    ["", "there"],
    [null, "there"],
  ])("resolves %s to %s", (value, expected) => {
    expect(getFirstName(value)).toBe(expected);
  });

  it("keeps the approved community copy and links together", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    const text = getCommunityEmailText().join("\n");
    const html = renderCommunityEmailBlocks();

    expect(text).toContain("STAY IN THE LOOP");
    expect(text).toContain("Join the Fair Play WhatsApp group for upcoming games, availability and community updates.");
    expect(text).toContain(FAIR_PLAY_WHATSAPP_GROUP_URL);
    expect(text).toContain("FAIR PLAY REWARDS");
    expect(text).toContain("Play 5 games. Get your 6th free.");
    expect(text).toContain("Complete five qualifying paid Fair Play games and receive £5 credit towards your next game.");
    expect(text).toContain("£5 for you. £5 for them.");
    expect(text).toContain("Invite a new player with your referral code and you’ll both receive £5 Fair Play credit. Their £5 unlocks after their first qualifying paid game.");
    expect(html).toContain(`href="${FAIR_PLAY_WHATSAPP_GROUP_URL}"`);
    expect(html).toContain('href="http://localhost:3000/rewards"');
  });

  it("normalizes configured game formats for email details", () => {
    expect(formatGameType(["6-a-side"])).toBe("6v6");
    expect(formatGameType(["7-a-side"])).toBe("7v7");
    expect(formatGameType(["8-a-side"])).toBe("8v8");
    expect(formatGameType(["Indoor"])).toBe("Indoor");
  });
});
