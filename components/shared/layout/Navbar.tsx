"use client";

import { useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";

interface Profile {
  username?: string | null;
  avatar_url?: string | null;
}

interface NavbarProps {
  user: User | null;
  profile: Profile | null;
  isAdmin?: boolean;
  unreadNotificationCount?: number;
  onLogout: () => void;
  onSignIn: () => void;
}

export default function Navbar({ user, profile, isAdmin = false, unreadNotificationCount = 0, onLogout, onSignIn }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  const navLinks = [
    { label: "Home", href: "/" },
    { label: "Games", href: "/#games" },
    ...(user ? [{ label: "Profile", href: "/profile" }] : []),
    ...(user ? [{ label: "Wallet", href: "/wallet" }] : []),
    ...(user ? [{ label: "My Bookings", href: "/my-bookings" }] : []),
    { label: "About", href: "/#about" },
    ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];

  const handleMobileLogout = () => {
    setIsMenuOpen(false);
    onLogout();
  };

  const handleMobileSignIn = () => {
    setIsMenuOpen(false);
    onSignIn();
  };

  const renderNavLinks = (isMobile = false) =>
    navLinks.map((link) => {
      const showNotificationBadge = link.href === "/profile" && unreadNotificationCount > 0;

      return (
      <Link
        key={link.href}
        href={link.href}
        className={
          isMobile
            ? "flex items-center gap-2 text-gray-300 hover:text-white transition font-medium py-2"
            : "inline-flex items-center gap-2 text-gray-300 hover:text-white transition font-medium text-sm"
        }
        onClick={isMobile ? () => setIsMenuOpen(false) : undefined}
      >
        <span>{link.label}</span>
        {showNotificationBadge ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-stone-200">
            {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
          </span>
        ) : null}
      </Link>
      );
    });

  const renderAuthControls = (isMobile = false) =>
    user ? (
      <div
        className={
          isMobile
            ? "flex items-center justify-between gap-3 rounded-3xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-200"
            : "flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-950/80 px-4 py-2 text-sm text-zinc-200"
        }
      >
        <span className="inline-flex items-center gap-2 font-semibold text-white">
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
          {displayName}
          {unreadNotificationCount > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-1.5 py-0.5 text-[0.65rem] font-bold leading-none text-stone-200">
              {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
            </span>
          ) : null}
        </span>
        <button
          onClick={isMobile ? handleMobileLogout : onLogout}
          className="rounded-full border border-stone-300/20 bg-zinc-900 px-3 py-1 font-semibold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800 hover:text-white"
        >
          Sign out
        </button>
      </div>
    ) : (
      <button
        onClick={isMobile ? handleMobileSignIn : onSignIn}
        className={
          isMobile
            ? "block w-full text-left text-gray-300 hover:text-white transition font-medium py-2"
            : "text-gray-300 hover:text-white transition font-medium text-sm"
        }
      >
        Sign in
      </button>
    );

  return (
    <nav className="sticky top-0 z-40 bg-black border-b border-zinc-800/60 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="text-xl font-black text-white tracking-[0.3em]">
            FAIR PLAY
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-10">
          {renderNavLinks()}
          {renderAuthControls()}
        </div>

        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="md:hidden flex h-11 w-11 items-center justify-center"
          aria-label="Toggle navigation menu"
        >
          <div className="flex w-6 flex-col gap-1.5">
            <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "rotate-45 translate-y-2" : ""}`} />
            <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "opacity-0" : ""}`} />
            <div className={`w-full h-0.5 bg-white transition-all ${isMenuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
          </div>
        </button>
      </div>

      {isMenuOpen && (
        <div className="md:hidden bg-black border-t border-zinc-800/60 px-6 py-4 space-y-3">
          {renderNavLinks(true)}
          {renderAuthControls(true)}
        </div>
      )}
    </nav>
  );
}
