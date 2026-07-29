import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const myBookingsSource = readFileSync(join(process.cwd(), "app/my-bookings/page.tsx"), "utf8");

describe("navigation and my bookings source", () => {
  it("groups desktop and mobile navigation into public and account sections", () => {
    expect(navbarSource).toContain("const publicNavLinks = [");
    expect(navbarSource).toContain('{ label: "Home", href: "/" }');
    expect(navbarSource).toContain('{ label: "Games", href: "/#games" }');
    expect(navbarSource).toContain('{ label: "About", href: "/#about" }');
    expect(navbarSource).toContain("const accountNavLinks = [");
    expect(navbarSource).toContain('{ label: "My Bookings", href: "/my-bookings" }');
    expect(navbarSource).toContain('{ label: "Wallet", href: "/wallet" }');
    expect(navbarSource).toContain('{ label: "Profile", href: "/profile" }');
    expect(navbarSource).toContain('...(isAdmin ? [{ label: "Admin", href: "/admin" }] : [])');
    expect(navbarSource).toContain('renderMobileNavGroup("Browse", publicNavLinks)');
    expect(navbarSource).toContain('renderMobileNavGroup("Account", accountNavLinks)');
    expect(navbarSource).toContain("h-5 w-px bg-zinc-800/80");
  });

  it("keeps active-link affordances without changing routes", () => {
    expect(navbarSource).toContain("usePathname");
    expect(navbarSource).toContain("aria-current={isActive ? \"page\" : undefined}");
    expect(navbarSource).toContain("pathname === href");
  });

  it("makes booking cards accessible links to the existing game-details flow", () => {
    expect(myBookingsSource).toContain("openBookingDetails");
    expect(myBookingsSource).toContain("useRouter");
    expect(myBookingsSource).toContain("router.push");
    expect(myBookingsSource).toContain("/?open_game_id=");
    expect(myBookingsSource).toContain("#games");
    expect(myBookingsSource).toContain('role="link"');
    expect(myBookingsSource).toContain("tabIndex={0}");
    expect(myBookingsSource).toContain("handleBookingCardKeyDown");
    expect(myBookingsSource).toContain('event.key !== "Enter" && event.key !== " "');
    expect(myBookingsSource).toContain("handleLeaveClick");
    expect(myBookingsSource).toContain("event.stopPropagation()");
    expect(myBookingsSource).not.toContain("import GameDetails");
  });
});
