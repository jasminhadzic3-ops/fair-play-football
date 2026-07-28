import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const contactPageSource = readFileSync(join(process.cwd(), "app/contact/page.tsx"), "utf8");
const footerSource = readFileSync(join(process.cwd(), "components/shared/layout/Footer.tsx"), "utf8");
const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const privacyPageSource = readFileSync(join(process.cwd(), "app/privacy/page.tsx"), "utf8");
const termsPageSource = readFileSync(join(process.cwd(), "app/terms/page.tsx"), "utf8");

describe("contact page source", () => {
  it("uses the configured support email without hardcoding a personal address", () => {
    expect(contactPageSource).toContain("process.env.NEXT_PUBLIC_SUPPORT_EMAIL");
    expect(contactPageSource).toContain("process.env.EMAIL_REPLY_TO");
    expect(contactPageSource).toContain("mailto:");
    expect(contactPageSource).not.toContain("jasminhadzic3@gmail.com");
    expect(contactPageSource).not.toContain("jasminhadzic");
  });

  it("includes the approved Contact and Support structure", () => {
    expect(contactPageSource).toContain("Contact & Support");
    expect(contactPageSource).toContain("Usually reply within");
    expect(contactPageSource).toContain("24 hours");
    expect(contactPageSource).toContain("General enquiries");
    expect(contactPageSource).toContain("Booking issues");
    expect(contactPageSource).toContain("Refund questions");
    expect(contactPageSource).toContain("Report a problem");
    expect(contactPageSource).toContain("Email Support");
    expect(contactPageSource).toContain("Browse Games");
  });

  it("reuses concise policy wording across the required FAQ topics", () => {
    expect(contactPageSource).toContain("Booking");
    expect(contactPageSource).toContain("Places are confirmed on a first paid, first served basis.");
    expect(contactPageSource).toContain("Payments");
    expect(contactPageSource).toContain("Wallet");
    expect(contactPageSource).toContain("Refunds");
    expect(contactPageSource).toContain("Cancel your booking at least 24 hours before kick-off");
    expect(contactPageSource).toContain("If you cancel within 24 hours of kick-off, no refund is available.");
    expect(contactPageSource).toContain("Waiting list");
    expect(contactPageSource).toContain("If a game is full, you can join the waiting list.");
    expect(contactPageSource).toContain("Game cancellations");
    expect(contactPageSource).toContain("If Fair Play Football cancels a game, all booked players receive a full refund.");
    expect(contactPageSource).toContain("Competitive vs Casual games");
    expect(contactPageSource).toContain("Age requirement");
    expect(contactPageSource).toContain("Players must be 18 or over.");
    expect(contactPageSource).toContain("Equipment / Boots");
    expect(contactPageSource).toContain("Astros, moulds and football boots are allowed. No metal studs.");
    expect(contactPageSource).toContain("Weather");
    expect(contactPageSource).toContain("Games usually go ahead in normal rain.");
  });

  it("uses semantic FAQ details and SEO metadata", () => {
    expect(contactPageSource).toContain("export const metadata");
    expect(contactPageSource).toContain("<details");
    expect(contactPageSource).toContain("<summary");
    expect(contactPageSource).toContain("focus-visible:ring-2");
  });
});

describe("shared footer source", () => {
  it("contains the approved footer links and keeps Contact out of the main navbar", () => {
    expect(footerSource).toContain('{ label: "Games", href: "/#games" }');
    expect(footerSource).toContain('{ label: "About", href: "/#about" }');
    expect(footerSource).toContain('{ label: "Contact", href: "/contact" }');
    expect(footerSource).toContain('{ label: "Privacy Policy", href: "/privacy" }');
    expect(footerSource).toContain('{ label: "Terms & Conditions", href: "/terms" }');
    expect(navbarSource).not.toContain('{ label: "Contact", href: "/contact" }');
  });

  it("is placed on legal pages without changing their core content", () => {
    expect(privacyPageSource).toContain("import Footer from");
    expect(privacyPageSource).toContain("<Footer />");
    expect(privacyPageSource).toContain("Privacy Policy");
    expect(termsPageSource).toContain("import Footer from");
    expect(termsPageSource).toContain("<Footer />");
    expect(termsPageSource).toContain("Terms of Service");
  });
});
