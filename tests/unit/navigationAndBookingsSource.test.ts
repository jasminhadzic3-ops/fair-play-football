import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const navbarSource = readFileSync(join(process.cwd(), "components/shared/layout/Navbar.tsx"), "utf8");
const myBookingsSource = readFileSync(join(process.cwd(), "app/my-bookings/page.tsx"), "utf8");

describe("navigation and my bookings source", () => {
  it("groups desktop navigation into premium brand, navigation and account zones", () => {
    expect(navbarSource).toContain("const publicNavLinks = [");
    expect(navbarSource).toContain('{ label: "Games", href: "/#games" }');
    expect(navbarSource).toContain('{ label: "How it works", href: "/#how-it-works" }');
    expect(navbarSource).toContain('{ label: "Venues", href: "/#venues" }');
    expect(navbarSource).toContain('{ label: "FAQ", href: "/#faq" }');
    expect(navbarSource).toContain("Find a game");
    expect(navbarSource).toContain("const accountNavLinks = [");
    expect(navbarSource).toContain('{ label: "My Bookings", href: "/my-bookings" }');
    expect(navbarSource).toContain('{ label: "Wallet & Rewards", href: "/wallet" }');
    expect(navbarSource).toContain('{ label: "Profile", href: "/profile" }');
    expect(navbarSource).toContain("const adminNavLinks = [");
    expect(navbarSource).toContain('...(isAdmin ? [{ label: "Admin", href: "/admin" }] : [])');
    expect(navbarSource).toContain("const mobileAccountNavLinks = [");
    expect(navbarSource).toContain("const desktopPlayerNavLinks = [");
    expect(navbarSource).toContain('accountNavLinks.filter((link) => link.href !== "/profile")');
    expect(navbarSource).toContain("min-[1360px]:grid");
    expect(navbarSource).toContain("min-[1360px]:grid-cols-[minmax(10rem,1fr)_auto_minmax(10rem,1fr)]");
    expect(navbarSource).toContain("min-[1360px]:px-8");
    expect(navbarSource).toContain("font-semibold text-zinc-200 hover:text-white");
    expect(navbarSource).toContain('renderNavLinks(desktopPlayerNavLinks, false, "player")');
    expect(navbarSource).toContain("{renderNavLinks(publicNavLinks)}");
    expect(navbarSource).toContain("text-lg font-black tracking-[0.3em] text-white min-[1360px]:text-[1.05rem]");
    expect(navbarSource).toContain("Browse");
    expect(navbarSource).toContain("{renderNavLinks(publicNavLinks, true)}");
    expect(navbarSource).toContain('renderMobileNavGroup("Account", mobileAccountNavLinks)');
    expect(navbarSource).toContain('href="/profile"');
    expect(navbarSource).toContain("View profile for");
    expect(navbarSource).not.toContain("max-w-7xl");
    expect(navbarSource).not.toContain("h-4 w-px bg-zinc-800/70");
    expect(navbarSource).not.toContain("md:grid");
  });

  it("keeps the notification bell as the final signed-in desktop control", () => {
    const desktopAccountStart = navbarSource.indexOf('aria-label={`View profile for');
    const signOutStart = navbarSource.indexOf("onClick={onLogout}", desktopAccountStart);
    const bellStart = navbarSource.indexOf("<NotificationBell", signOutStart);

    expect(desktopAccountStart).toBeGreaterThan(-1);
    expect(signOutStart).toBeGreaterThan(desktopAccountStart);
    expect(bellStart).toBeGreaterThan(signOutStart);
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

  it("filters My Bookings to actionable game lifecycles", () => {
    expect(myBookingsSource).toContain('import { canPlayerLeave } from "@/lib/gameLifecycle"');
    expect(myBookingsSource).toContain("id, title, location, time, price, status, starts_at, archived_at");
    expect(myBookingsSource).toContain("const now = new Date()");
    expect(myBookingsSource).toContain("game && canPlayerLeave(game, { now })");
  });

  it("relies on the shared lifecycle helper for active, completed, cancelled, archived and full states", () => {
    expect(myBookingsSource).toContain("canPlayerLeave(game, { now })");
    expect(myBookingsSource).not.toContain("game.status ===");
    expect(myBookingsSource).not.toContain("new Date(game.starts_at");
    expect(myBookingsSource).not.toContain("starts_at <=");
    expect(myBookingsSource).not.toContain("archived_at ===");
  });
});
