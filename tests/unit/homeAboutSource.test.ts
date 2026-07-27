import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const gameDetailsSource = readFileSync(join(process.cwd(), "components/games/GameDetails.tsx"), "utf8");
const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");

describe("homepage about section source", () => {
  it("adds a navbar-compatible About section with the approved positioning", () => {
    expect(navbarSource).toContain('href: "/#about"');
    expect(homePageSource).toContain('<section id="about"');
    expect(homePageSource).toContain("Friendly games, good vibes and all skill levels welcome.");
    expect(homePageSource).toContain("co-ed 18+ football platform");
    expect(homePageSource).toContain("organises friendly games across North");
    expect(homePageSource).toContain("haven't kicked a ball in years");
    expect(homePageSource).toContain("Beginners, returning players and regular players");
  });

  it("explains casual and competitive games without changing game cards", () => {
    expect(homePageSource).toContain("Some games are casual, while others are more competitive.");
    expect(homePageSource).toContain("When a game is competitive, it will be");
    expect(homePageSource).toContain("clearly labelled on the game card");
  });

  it("covers how it works, player expectations, locations and FAQs", () => {
    expect(homePageSource).toContain("Find a game");
    expect(homePageSource).toContain("Book and pay");
    expect(homePageSource).toContain("Turn up and play");
    expect(homePageSource).toContain("Fresh bibs and footballs are provided.");
    expect(homePageSource).toContain("No slide tackles.");
    expect(homePageSource).toContain("North London locations");
    expect(homePageSource).toContain("What happens if a game is full?");
    expect(homePageSource).toContain("What do I need to bring?");
  });

  it("uses the current goalkeeper rule and conservative refund wording", () => {
    expect(gameDetailsSource).toContain("Goalkeeper rotates every 8 minutes");
    expect(homePageSource).toContain("Goalkeeper rotates every 8 minutes.");
    expect(homePageSource).toContain("If Fair Play Football cancels a game");
    expect(homePageSource).toContain("including because not enough players are confirmed");
    expect(homePageSource).toContain("Player cancellation refund eligibility is handled in the app");
    expect(homePageSource).not.toContain("cancel your booking at least 24 hours before kick-off");
  });

  it("shows Find Games and signed-out Sign Up CTAs", () => {
    expect(homePageSource).toContain('href="#games"');
    expect(homePageSource).toContain("Find Games");
    expect(homePageSource).toContain("setNavbarAuthMode(\"signup\")");
    expect(homePageSource).toContain("Sign Up");
    expect(homePageSource).toContain("{!user ? (");
  });
});
