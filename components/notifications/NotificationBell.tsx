"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";

type NotificationRow = {
  id: number;
  type: string;
  category: string;
  title: string;
  body: string;
  icon: string;
  action_url: string | null;
  action_label: string | null;
  read_at: string | null;
  created_at: string | null;
};

type NotificationBellProps = {
  unreadCount: number;
  realtimeVersion?: number;
  onUnreadCountChange?: (count: number) => void;
};

function formatBadgeCount(count: number) {
  if (count <= 0) {
    return "";
  }

  return count > 99 ? "99+" : String(count);
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? "min" : "mins"} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return date.toLocaleDateString("en-GB", { weekday: "long" });
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? null;
}

async function fetchJsonWithAuth(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();

  if (!token) {
    throw new Error("Please sign in to view notifications.");
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(result?.error || "Unable to load notifications.");
  }

  return result;
}

export default function NotificationBell({
  unreadCount,
  realtimeVersion = 0,
  onUnreadCountChange,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const badgeCount = formatBadgeCount(unreadCount);

  const updateDropdownPosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const safeMargin = 12;
    const maxWidth = 352;
    const width = Math.max(0, Math.min(maxWidth, viewportWidth - safeMargin * 2));
    const buttonRect = button.getBoundingClientRect();
    const preferredLeft = buttonRect.right - width;
    const minLeft = viewportLeft + safeMargin;
    const maxLeft = viewportLeft + viewportWidth - safeMargin - width;
    const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));

    setDropdownPosition({
      left,
      top: buttonRect.bottom + 8 + (visualViewport?.offsetTop ?? 0),
      width,
    });
  }, []);

  const loadNotifications = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await fetchJsonWithAuth("/api/notifications?limit=6");

      setNotifications(result.notifications ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load notifications.");
    } finally {
      setIsLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    updateDropdownPosition();

    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.visualViewport?.addEventListener("resize", updateDropdownPosition);
    window.visualViewport?.addEventListener("scroll", updateDropdownPosition);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.visualViewport?.removeEventListener("resize", updateDropdownPosition);
      window.visualViewport?.removeEventListener("scroll", updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadNotifications();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || realtimeVersion <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadNotifications();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isOpen, realtimeVersion]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const markNotificationAsRead = async (notificationId: number) => {
    await fetchJsonWithAuth(`/api/notifications/${notificationId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "mark_read" }),
    });
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
          : notification
      )
    );
    onUnreadCountChange?.(Math.max(0, unreadCount - 1));
  };

  const markAllAsRead = async () => {
    await fetchJsonWithAuth("/api/notifications/mark-all-read", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        read_at: notification.read_at ?? new Date().toISOString(),
      }))
    );
    onUnreadCountChange?.(0);
  };

  const handleNotificationClick = async (notification: NotificationRow) => {
    if (!notification.read_at) {
      await markNotificationAsRead(notification.id).catch(() => {});
    }

    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="notification-bell-button relative flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-stone-300/25 hover:bg-zinc-900 hover:text-white hover:shadow-[0_14px_34px_rgba(0,0,0,0.35)]"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={isOpen}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badgeCount ? (
          <span className="notification-badge absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full border border-black bg-red-500 px-1.5 py-0.5 text-[0.62rem] font-black leading-none text-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]">
            {badgeCount}
          </span>
        ) : null}
      </button>

      {isOpen && dropdownPosition && typeof document !== "undefined" ? createPortal(
        <div
          ref={dropdownRef}
          className="notification-dropdown-enter fixed z-50 flex max-h-[min(32rem,calc(100dvh-5.5rem))] flex-col overflow-hidden rounded-[1.7rem] border border-zinc-800 bg-zinc-950 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
          style={{
            left: dropdownPosition.left,
            top: dropdownPosition.top,
            width: dropdownPosition.width,
          }}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
            <div>
              <p className="text-sm font-black text-white">Notifications</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-500">
                {unreadCount > 0 ? `${formatBadgeCount(unreadCount)} unread` : "All caught up"}
              </p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllAsRead()}
                className="rounded-full px-3 py-1.5 text-xs font-bold text-stone-300 transition duration-200 hover:bg-zinc-900 hover:text-white"
              >
                Mark all as read
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-20 animate-pulse rounded-3xl bg-zinc-900" />
                ))}
              </div>
            ) : null}

            {!isLoading && errorMessage ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4 text-sm font-semibold text-zinc-300">
                {errorMessage}
              </div>
            ) : null}

            {!isLoading && !errorMessage && notifications.length === 0 ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-base font-black text-white">{"You're all caught up ⚽"}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  New booking updates, reminders and wallet activity will appear here.
                </p>
              </div>
            ) : null}

            {!isLoading && !errorMessage && notifications.length > 0 ? (
              <div className="space-y-1">
                {notifications.map((notification, index) => {
                  const isUnread = !notification.read_at;

                  return (
                    <div
                      key={notification.id}
                      className={`notification-card-enter group rounded-3xl border p-3 transition duration-200 ${
                        isUnread
                          ? "border-stone-300/15 bg-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          : "border-transparent bg-zinc-950 hover:border-zinc-800 hover:bg-zinc-900"
                      }`}
                      style={{ animationDelay: `${index * 34}ms` }}
                    >
                      <Link
                        href={notification.action_url || "/notifications"}
                        onClick={() => void handleNotificationClick(notification)}
                        className="flex gap-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-stone-300/10 bg-black text-lg">
                          {notification.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-3">
                            <span className="text-sm font-black leading-5 text-white">
                              {notification.title}
                            </span>
                            {isUnread ? (
                              <span className="notification-unread-dot mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                            ) : null}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-zinc-400">
                            {notification.body}
                          </span>
                          <span className="mt-1 block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                            {formatRelativeTime(notification.created_at)}
                          </span>
                        </span>
                      </Link>
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={() => void markNotificationAsRead(notification.id)}
                          className="ml-12 mt-2 inline-flex min-h-9 items-center rounded-full px-3 text-xs font-bold text-stone-300 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 hover:text-white"
                        >
                          Mark as read
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-800/80 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="inline-flex min-h-10 items-center text-sm font-bold text-stone-200 transition hover:text-white"
            >
              View all notifications
            </Link>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
