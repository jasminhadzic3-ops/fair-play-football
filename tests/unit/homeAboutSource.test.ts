import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(join(process.cwd(), "components/home/HomeClient.tsx"), "utf8");
const gameDetailsSource = readFileSync(join(process.cwd(), "components/games/GameDetails.tsx"), "utf8");
const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const footerSource = readFileSync(join(process.cwd(), "components/shared/layout/Footer.tsx"), "utf8");
const refundPolicySource = readFileSync(join(process.cwd(), "lib/refundPolicy.ts"), "utf8");

describe("homepage about section source", () => {
  it("adds a navbar-compatible About section with the approved positioning", () => {
    expect(navbarSource).toContain('href: "/#how-it-works"');
    expect(navbarSource).toContain('href: "/#venues"');
    expect(navbarSource).toContain('href: "/#faq"');
    expect(homePageSource).toContain('<section id="about"');
    expect(homePageSource).toContain("Fair Play is about more than just playing a game.");
    expect(homePageSource).toContain("It’s about building a friendly football community where people can enjoy regular games, meet new players and play without pressure or commitment.");
    expect(homePageSource).toContain("Our aim is simple: to make football affordable, welcoming and easy to join for everyone, regardless of your level.");
    expect(homePageSource).toContain("Come and try your first Fair Play game for free using the Fair Play <strong>Referral Reward</strong> and see what we’re all about.");
    expect(homePageSource).toContain("Beginners, returning players and regular players");
  });

  it("explains casual and competitive games without changing game cards", () => {
    expect(homePageSource).toContain("Some games are casual, while others are more competitive.");
    expect(homePageSource).toContain("When a game is competitive, it will be");
    expect(homePageSource).toContain("clearly labelled on the game card");
  });

  it("covers how it works, player expectations, locations and FAQs", () => {
    expect(homePageSource).toContain("Choose a game. Book your place. Turn up and play.");
    expect(homePageSource).toContain("Pick the date, venue and playing style that suits you.");
    expect(homePageSource).toContain("Pay securely online and receive your game details immediately.");
    expect(homePageSource).toContain("Turn up and play");
    expect(homePageSource).toContain("Meet your host, collect a bib and join the game. Teams are organised on the day.");
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
    expect(homePageSource).toContain("Stay connected between games");
    expect(homePageSource).toContain("Join the Fair Play player community for new-game alerts, last-minute availability and local updates. All bookings and payments stay on fairplayfootball.co.uk.");
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

  it("orders game details policy, wallet and booking actions without changing wallet behaviour", () => {
    const rulesIndex = gameDetailsSource.indexOf("Rules</h3>");
    const refundIndex = gameDetailsSource.indexOf("Refund Policy</h3>");
    const walletIndex = gameDetailsSource.indexOf("WALLET");
    const waitingListIndex = gameDetailsSource.indexOf("Waiting list");
    const bookingIndex = gameDetailsSource.indexOf("Book Your Spot");

    expect(rulesIndex).toBeGreaterThan(-1);
    expect(refundIndex).toBeGreaterThan(rulesIndex);
    expect(walletIndex).toBeGreaterThan(refundIndex);
    expect(waitingListIndex).toBeGreaterThan(walletIndex);
    expect(bookingIndex).toBeGreaterThan(walletIndex);
    expect(gameDetailsSource).toContain("Available balance");
    expect(gameDetailsSource).toContain("formatWalletBalance(walletBalance ?? 0)");
    expect(gameDetailsSource).toContain("const showWalletSection = isAuthenticated && (walletBalanceLoading || walletBalance !== null);");
    expect(gameDetailsSource).toContain('showWalletSection ? "!-mt-0.5 sm:!mt-2" : ""');
    expect(gameDetailsSource).not.toContain("Available wallet balance");
    expect(gameDetailsSource).not.toContain("Credit available on your Fair Play Football account.");
  });

  it("shows approved game discovery and signed-out Sign Up CTAs", () => {
    expect(homePageSource).toContain('href="#games"');
    expect(homePageSource).toContain("Find a game");
    expect(homePageSource).toContain("View upcoming games");
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
