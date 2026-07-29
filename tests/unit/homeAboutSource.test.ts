import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const gameDetailsSource = readFileSync(join(process.cwd(), "components/games/GameDetails.tsx"), "utf8");
const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const footerSource = readFileSync(join(process.cwd(), "components/shared/layout/Footer.tsx"), "utf8");
const refundPolicySource = readFileSync(join(process.cwd(), "lib/refundPolicy.ts"), "utf8");

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
    expect(homePageSource).toContain("Our Venues");
    expect(homePageSource).toContain("We currently organise games at three high-quality 3G artificial grass venues across North London:");
    expect(homePageSource).toContain("Whittington Park");
    expect(homePageSource).toContain("📍 Whittington Park – Yerbury Road, Archway, London N19 4RS");
    expect(homePageSource).toContain("Cantelowes Gardens");
    expect(homePageSource).toContain("📍 Cantelowes Gardens (Talacre Community Sports Centre) – Dalby Street, Kentish Town, London NW5 3AF");
    expect(homePageSource).toContain("Barnard Park");
    expect(homePageSource).toContain("📍 Barnard Park – Copenhagen Street, Islington, London N1 0ER");
    expect(homePageSource).toContain("Fresh bibs and footballs are provided.");
    expect(homePageSource).toContain("No slide tackles.");
    expect(homePageSource).toContain("North London locations");
    expect(homePageSource).toContain("What happens if a game is full?");
    expect(homePageSource).toContain("What do I need to bring?");
  });

  it("uses the current goalkeeper rule and approved refund wording", () => {
    expect(gameDetailsSource).toContain("Goalkeeper rotates every 8 minutes");
    expect(homePageSource).toContain("Goalkeeper rotates every 8 minutes.");
    expect(homePageSource).toContain("Refund Policy");
    expect(homePageSource).toContain("REFUND_POLICY_ITEMS.map");
    expect(gameDetailsSource).toContain("REFUND_POLICY_ITEMS[0]");
    expect(gameDetailsSource).toContain("REFUND_POLICY_ITEMS[1]");
    expect(gameDetailsSource).toContain("REFUND_POLICY_ITEMS[2]");
    expect(gameDetailsSource).toContain("REFUND_POLICY_ITEMS[3]");
    expect(refundPolicySource).toContain("Cancel your booking at least 24 hours before kick-off and you'll receive a full refund.");
    expect(refundPolicySource).toContain("If you cancel within 24 hours of kick-off, no refund is available.");
    expect(refundPolicySource).toContain("If Fair Play Football cancels a game, all booked players receive a full refund.");
    expect(refundPolicySource).toContain("If a game is cancelled because the minimum number of players is not reached, all booked players receive a full refund.");
    expect(gameDetailsSource).not.toContain("Please allow 2-5 working days for refunds to appear.");
    expect(gameDetailsSource).not.toContain("You are eligible for a full refund if you cancel your booking");
    expect(gameDetailsSource).not.toContain("If a game is cancelled by the organiser");
  });

  it("shows Find Games and signed-out Sign Up CTAs", () => {
    expect(homePageSource).toContain('href="#games"');
    expect(homePageSource).toContain("Find Games");
    expect(homePageSource).toContain("setNavbarAuthMode(\"signup\")");
    expect(homePageSource).toContain("Sign Up");
    expect(homePageSource).toContain("{!user ? (");
  });

  it("adds Contact through the About CTA and shared footer only", () => {
    expect(homePageSource).toContain("Need more help?");
    expect(homePageSource).toContain("Contact Support");
    expect(homePageSource).toContain('href="/contact"');
    expect(homePageSource).toContain("<Footer />");
    expect(footerSource).toContain('{ label: "Contact", href: "/contact" }');
    expect(navbarSource).not.toContain('{ label: "Contact", href: "/contact" }');
  });
});
