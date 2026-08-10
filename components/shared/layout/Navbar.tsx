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

const whatsappCommunityUrl = "https://chat.whatsapp.com/JAGpOaEd8jf2njevCRK7JE?mode=gi_t";

function WhatsAppIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[1.05rem] w-[1.05rem] shrink-0 fill-[#25D366] transition-transform group-hover:scale-105"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.9 6.994c-.003 5.45-4.437 9.884-9.892 9.884M20.52 3.449A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.3-1.652a11.867 11.867 0 0 0 5.69 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.52 3.449Z" />
    </svg>
  );
}

function WhatsAppCommunityLink({ isMobile = false }: { isMobile?: boolean }) {
  if (!isMobile) {
    return (
      <div className="group relative flex items-center">
        <button
          type="button"
          aria-label="Join our WhatsApp Community"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-300 transition hover:bg-zinc-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
        >
          <WhatsAppIcon />
        </button>

        <div className="pointer-events-none absolute right-0 top-full z-50 w-72 translate-y-1 pt-3 opacity-0 transition duration-200 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
            <p className="text-base font-bold text-white">Join our WhatsApp Community</p>
            <p className="mt-1.5 text-sm leading-6 text-zinc-400">Games, updates &amp; announcements.</p>
            <a
              href={whatsappCommunityUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join our WhatsApp Community"
              className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-[#25D366]/30 bg-[#25D366] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#2ee271] focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
            >
              Join Now
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={whatsappCommunityUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join our WhatsApp Community"
      className="group flex items-center gap-2 py-2 font-medium text-gray-300 transition hover:text-white"
    >
      <WhatsAppIcon />
      <span>Join WhatsApp Community</span>
    </a>
  );
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
    { label: "Home", href: "/" },
    { label: "Games", href: "/#games" },
    { label: "About", href: "/#about" },
  ];

  const accountNavLinks = [
    ...(user ? [{ label: "My Bookings", href: "/my-bookings" }] : []),
    ...(user ? [{ label: "Wallet", href: "/wallet" }] : []),
    ...(user ? [{ label: "Profile", href: "/profile" }] : []),
  ];

  const adminNavLinks = [
    ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];

  const mobileAccountNavLinks = [
    ...accountNavLinks,
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
    emphasizeDesktop = false
  ) =>
    links.map((link) => {
      const isActive = isActiveLink(link.href);
      const desktopLinkTone = emphasizeDesktop
        ? isActive
          ? "font-semibold text-white"
          : "font-semibold text-zinc-200 hover:text-white"
        : isActive
          ? "font-medium text-white"
          : "font-medium text-gray-300 hover:text-white";

      return (
      <Link
        key={link.href}
        href={link.href}
        className={
          isMobile
            ? `flex items-center gap-2 py-2 font-medium transition ${isActive ? "text-white" : "text-gray-300 hover:text-white"}`
            : `inline-flex items-center gap-2 text-sm transition ${desktopLinkTone}`
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

  const renderAuthControls = (isMobile = false) =>
    user ? (
      <div
        className={
          isMobile
            ? "flex items-center justify-between gap-3 rounded-3xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-200"
            : "flex min-w-0 items-center gap-3 rounded-full border border-zinc-700 bg-zinc-950/80 px-4 py-2 text-sm text-zinc-200"
        }
      >
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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-3 py-3 sm:px-4 lg:px-5 md:grid md:grid-cols-[auto_auto_minmax(0,1fr)] md:gap-14">
        <Link href="/" className="flex shrink-0 items-center gap-3 justify-self-start">
          <span className="text-lg font-black tracking-[0.3em] text-white md:text-[1.05rem]">
            FAIR PLAY
          </span>
        </Link>

        <div className="hidden min-w-0 items-center justify-start gap-5 border-r border-zinc-800/50 pr-7 md:flex">
          {accountNavLinks.length > 0 ? (
            <div className="flex min-w-0 items-center gap-4 lg:gap-5">
              {renderNavLinks(accountNavLinks, false, true)}
            </div>
          ) : null}
        </div>

        <div className="hidden min-w-0 items-center justify-end gap-4 md:flex">
          <div className="flex items-center gap-4 lg:gap-5">
            {renderNavLinks(publicNavLinks)}
            <WhatsAppCommunityLink />
            {renderNavLinks(adminNavLinks)}
          </div>
          {user ? <span className="h-4 w-px bg-zinc-800/70" aria-hidden="true" /> : null}
          {user ? (
            <NotificationBell
              unreadCount={unreadNotificationCount}
              realtimeVersion={notificationRealtimeVersion}
              onUnreadCountChange={onUnreadNotificationCountChange}
            />
          ) : null}
          {renderAuthControls()}
        </div>

        <div className="flex items-center gap-2 md:hidden">
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
        <div className="md:hidden space-y-5 border-t border-zinc-800/60 bg-black px-6 py-4">
          <div className="space-y-1">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-zinc-600">Browse</p>
            <div className="grid gap-1">
              {renderNavLinks(publicNavLinks, true)}
              <WhatsAppCommunityLink isMobile />
            </div>
          </div>
          {mobileAccountNavLinks.length > 0 ? renderMobileNavGroup("Account", mobileAccountNavLinks) : null}
          {renderAuthControls(true)}
        </div>
      )}
    </nav>
  );
}
