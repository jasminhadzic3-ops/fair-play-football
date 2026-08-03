import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const myBookingsSource = readFileSync(join(process.cwd(), "app/my-bookings/page.tsx"), "utf8");

describe("navigation and my bookings source", () => {
  it("groups desktop navigation into logo, centred account and right public sections", () => {
    expect(navbarSource).toContain("const publicNavLinks = [");
    expect(navbarSource).toContain('{ label: "Home", href: "/" }');
    expect(navbarSource).toContain('{ label: "Games", href: "/#games" }');
    expect(navbarSource).toContain('{ label: "About", href: "/#about" }');
    expect(navbarSource).toContain("const accountNavLinks = [");
    expect(navbarSource).toContain('{ label: "My Bookings", href: "/my-bookings" }');
    expect(navbarSource).toContain('{ label: "Wallet", href: "/wallet" }');
    expect(navbarSource).toContain('{ label: "Profile", href: "/profile" }');
    expect(navbarSource).toContain("const adminNavLinks = [");
    expect(navbarSource).toContain('...(isAdmin ? [{ label: "Admin", href: "/admin" }] : [])');
    expect(navbarSource).toContain("const mobileAccountNavLinks = [");
    expect(navbarSource).toContain("items-center justify-between gap-5 px-3 py-3");
    expect(navbarSource).toContain("md:grid md:grid-cols-[auto_auto_minmax(0,1fr)] md:gap-14");
    expect(navbarSource).toContain("hidden min-w-0 items-center justify-start gap-5 border-r border-zinc-800/50 pr-7 md:flex");
    expect(navbarSource).toContain("font-semibold text-zinc-200 hover:text-white");
    expect(navbarSource).toContain("renderNavLinks(accountNavLinks, false, true)");
    expect(navbarSource).toContain("{renderNavLinks(publicNavLinks)}");
    expect(navbarSource).toContain("{renderNavLinks(adminNavLinks)}");
    expect(navbarSource).toContain("text-lg font-black tracking-[0.3em] text-white md:text-[1.05rem]");
    expect(navbarSource).toContain('renderMobileNavGroup("Browse", publicNavLinks)');
    expect(navbarSource).toContain('renderMobileNavGroup("Account", mobileAccountNavLinks)');
    expect(navbarSource).toContain("h-4 w-px bg-zinc-800/70");
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
