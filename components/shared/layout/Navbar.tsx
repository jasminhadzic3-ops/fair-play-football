"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import NotificationBell from "@/components/notifications/NotificationBell";

interface Profile {
  username?: string | null;
  avatar_url?: string | null;
}

interface NavbarProps {
  user: User | null;
  profile: Profile | null;
  isAdmin?: boolean;
  unreadNotificationCount?: number;
  notificationRealtimeVersion?: number;
  onUnreadNotificationCountChange?: (count: number) => void;
  onLogout: () => void;
  onSignIn: () => void;
}

export default function Navbar({
  user,
  profile,
  isAdmin = false,
  unreadNotificationCount = 0,
  notificationRealtimeVersion = 0,
  onUnreadNotificationCountChange,
  onLogout,
  onSignIn,
}: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const displayName =
    profile?.username?.trim() ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    user?.email;
  const initials =
    displayName
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join("") || "FP";

  const publicNavLinks = [
    { label: "Games", href: "/#games" },
    { label: "Venues", href: "/#venues" },
    { label: "FAQ", href: "/#faq" },
  ];

  const accountNavLinks = [
    ...(user ? [{ label: "My Bookings", href: "/my-bookings" }] : []),
    ...(user ? [{ label: "Wallet & Rewards", href: "/wallet" }] : []),
    ...(user ? [{ label: "Profile", href: "/profile" }] : []),
  ];

  const adminNavLinks = [
    ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];

  const mobileAccountNavLinks = [
    ...accountNavLinks,
    ...adminNavLinks,
  ];

  const desktopPlayerNavLinks = [
    ...accountNavLinks.filter((link) => link.href !== "/profile"),
    ...adminNavLinks,
  ];

  const handleMobileLogout = () => {
    setIsMenuOpen(false);
    onLogout();
  };

  const handleMobileSignIn = () => {
    setIsMenuOpen(false);
    onSignIn();
  };

  const isActiveLink = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }

    if (href.includes("#")) {
      return false;
    }

    return pathname === href;
  };

  const renderNavLinks = (
    links: Array<{ label: string; href: string }>,
    isMobile = false,
    desktopTone: "public" | "player" = "public"
  ) =>
    links.map((link) => {
      const isActive = isActiveLink(link.href);
      const desktopLinkTone = desktopTone === "player"
        ? isActive
          ? "font-semibold text-white after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-stone-200"
          : "font-semibold text-zinc-200 hover:text-white"
        : isActive
          ? "font-medium text-white after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-stone-300"
          : "font-medium text-zinc-400 hover:text-white";

      return (
      <Link
        key={link.href}
        href={link.href}
        className={
          isMobile
            ? `flex items-center gap-2 py-2 font-medium transition ${isActive ? "text-white" : "text-gray-300 hover:text-white"}`
            : link.href === "/wallet"
              ? "inline-flex min-h-10 items-center whitespace-nowrap rounded-full bg-stone-200 px-4 text-[0.82rem] font-bold text-zinc-950 transition-colors duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/60 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
            : `relative inline-flex min-h-10 items-center whitespace-nowrap text-[0.82rem] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black ${desktopLinkTone}`
        }
        aria-current={isActive ? "page" : undefined}
        onClick={isMobile ? () => setIsMenuOpen(false) : undefined}
      >
        <span>{link.label}</span>
      </Link>
      );
    });

  const renderMobileNavGroup = (title: string, links: Array<{ label: string; href: string }>) => (
    <div className="space-y-1">
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-zinc-600">{title}</p>
      <div className="grid gap-1">{renderNavLinks(links, true)}</div>
    </div>
  );

  const renderMobileAuthControls = () =>
    user ? (
      <div className="flex items-center justify-between gap-3 rounded-3xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-200">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-white">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-[0.65rem] font-bold text-stone-200">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </span>
          <span className="min-w-0 max-w-[11rem] truncate">{displayName}</span>
        </span>
        <button
          onClick={handleMobileLogout}
          className="rounded-full border border-stone-300/20 bg-zinc-900 px-3 py-1 font-semibold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800 hover:text-white"
        >
          Sign out
        </button>
      </div>
    ) : (
      <button
        onClick={handleMobileSignIn}
        className="block w-full py-2 text-left font-medium text-gray-300 transition hover:text-white"
      >
        Sign in
      </button>
    );

  return (
    <nav className="sticky top-0 z-40 border-b border-zinc-800/60 bg-black/95 backdrop-blur-sm">
      <div className="flex min-h-[4.25rem] w-full items-center justify-between gap-5 px-4 py-3 sm:px-6 min-[1360px]:grid min-[1360px]:grid-cols-[minmax(10rem,1fr)_auto_minmax(10rem,1fr)] min-[1360px]:gap-8 min-[1360px]:px-8 min-[1600px]:px-10">
        <Link
          href="/"
          className="flex shrink-0 items-center justify-self-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
        >
          <span className="text-lg font-black tracking-[0.3em] text-white min-[1360px]:text-[1.05rem]">
            FAIR PLAY
          </span>
        </Link>

        <div className="hidden min-w-0 items-center justify-center gap-10 min-[1360px]:flex">
          <div className="flex min-w-0 items-center gap-4">
            {renderNavLinks(publicNavLinks)}
          </div>
          {desktopPlayerNavLinks.length > 0 ? (
            <div className="flex min-w-0 items-center gap-4">
              {renderNavLinks(desktopPlayerNavLinks, false, "player")}
            </div>
          ) : null}
        </div>

        <div className="hidden min-w-0 items-center justify-self-end min-[1360px]:flex">
          {user ? (
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/profile"
                aria-label={`View profile for ${displayName || "player"}`}
                className="group inline-flex min-h-10 min-w-0 items-center gap-2.5 rounded-xl px-1.5 text-sm font-semibold text-zinc-200 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-[0.68rem] font-bold text-stone-200 transition-colors duration-200 group-hover:border-zinc-500">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                <span className="max-w-28 truncate">{displayName}</span>
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex min-h-10 items-center px-1.5 text-xs font-semibold text-zinc-500 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
              >
                Sign out
              </button>
              <NotificationBell
                unreadCount={unreadNotificationCount}
                realtimeVersion={notificationRealtimeVersion}
                onUnreadCountChange={onUnreadNotificationCountChange}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-zinc-400 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
            >
              Sign in
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 min-[1360px]:hidden">
          {user ? (
            <NotificationBell
              unreadCount={unreadNotificationCount}
              realtimeVersion={notificationRealtimeVersion}
              onUnreadCountChange={onUnreadNotificationCountChange}
            />
          ) : null}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex h-11 w-11 items-center justify-center"
            aria-label="Toggle navigation menu"
          >
            <div className="flex w-6 flex-col gap-1.5">
              <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "rotate-45 translate-y-2" : ""}`} />
              <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "opacity-0" : ""}`} />
              <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
            </div>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="space-y-5 border-t border-zinc-800/60 bg-black px-6 py-4 min-[1360px]:hidden">
          <div className="space-y-1">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-zinc-600">Browse</p>
            <div className="grid gap-1">
              {renderNavLinks(publicNavLinks, true)}
              {renderNavLinks(
                [{ label: "How it works", href: "/#how-it-works" }],
                true
              )}
              <Link
                href="/#games"
                className="flex items-center gap-2 py-2 font-semibold text-stone-200 transition hover:text-white"
                onClick={() => setIsMenuOpen(false)}
              >
                Find a game
              </Link>
            </div>
          </div>
          {mobileAccountNavLinks.length > 0 ? renderMobileNavGroup("Account", mobileAccountNavLinks) : null}
          {renderMobileAuthControls()}
        </div>
      )}
    </nav>
  );
}
