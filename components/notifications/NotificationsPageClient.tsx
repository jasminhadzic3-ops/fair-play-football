"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type NotificationFilter =
  | "all"
  | "unread"
  | "bookings"
  | "games"
  | "wallet"
  | "refunds"
  | "waiting_list";

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

const filters: Array<{ id: NotificationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "bookings", label: "Bookings" },
  { id: "games", label: "Games" },
  { id: "wallet", label: "Wallet" },
  { id: "refunds", label: "Refunds" },
  { id: "waiting_list", label: "Waiting List" },
];

function formatNotificationTime(value: string | null) {
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

export default function NotificationsPageClient() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadNotifications = useCallback(
    async ({ append = false, cursor = null }: { append?: boolean; cursor?: string | null } = {}) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const params = new URLSearchParams({ filter, limit: "20" });

        if (cursor) {
          params.set("cursor", cursor);
        }

        const result = await fetchJsonWithAuth(`/api/notifications?${params.toString()}`);
        const nextNotifications = (result.notifications ?? []) as NotificationRow[];

        setNotifications((current) => (append ? [...current, ...nextNotifications] : nextNotifications));
        setNextCursor(result.next_cursor ?? null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load notifications.");
        if (!append) {
          setNotifications([]);
          setNextCursor(null);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadNotifications();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadNotifications]);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | undefined;
    let isMounted = true;

    const subscribeToNotificationChanges = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!isMounted || !userId) {
        return;
      }

      subscription = supabase
        .channel(`notifications-page:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            void loadNotifications();
          }
        )
        .subscribe();
    };

    void subscribeToNotificationChanges();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [loadNotifications]);

  const updateNotification = async (notificationId: number, action: "mark_read" | "archive") => {
    await fetchJsonWithAuth(`/api/notifications/${notificationId}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });

    if (action === "archive") {
      setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      return;
    }

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read_at: notification.read_at ?? new Date().toISOString() }
          : notification
      )
    );
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
  };

  const openNotification = async (notification: NotificationRow) => {
    if (!notification.read_at) {
      await updateNotification(notification.id, "mark_read").catch(() => {});
    }
  };

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-zinc-500">
              Communication Hub
            </p>
            <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">
              Notifications
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllAsRead()}
                className="rounded-full border border-stone-300/20 bg-zinc-950 px-5 py-3 text-sm font-bold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-900 hover:text-white"
              >
                Mark all as read
              </button>
            ) : null}
            <Link
              href="/"
              className="rounded-full border border-stone-200/30 bg-stone-200 px-5 py-3 text-sm font-black text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:border-stone-100 hover:bg-stone-100"
            >
              Back to Home
            </Link>
          </div>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto rounded-[1.7rem] border border-zinc-800 bg-zinc-950 p-2">
          {filters.map((item) => {
            const isActive = filter === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                  isActive
                    ? "bg-stone-200 text-zinc-950"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-[2rem] border border-zinc-800 bg-zinc-950"
              />
            ))}
          </div>
        ) : null}

        {!isLoading && errorMessage ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 text-sm font-semibold text-zinc-300">
            {errorMessage}
          </div>
        ) : null}

        {!isLoading && !errorMessage && notifications.length === 0 ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-8 text-center shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <p className="text-2xl font-black text-white">{"You're all caught up ⚽"}</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">
              New booking updates, reminders and wallet activity will appear here.
            </p>
          </div>
        ) : null}

        {!isLoading && !errorMessage && notifications.length > 0 ? (
          <div className="space-y-3">
            {notifications.map((notification, index) => {
              const isUnread = !notification.read_at;

              return (
                <article
                  key={notification.id}
                  className={`notification-card-enter rounded-[2rem] border p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] transition duration-200 hover:-translate-y-0.5 hover:border-stone-200/20 ${
                    isUnread ? "border-stone-300/15 bg-zinc-950" : "border-zinc-800 bg-zinc-950/80"
                  }`}
                  style={{ animationDelay: `${index * 36}ms` }}
                >
                  <div className="flex gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl border border-stone-300/10 bg-zinc-900 text-2xl">
                      {notification.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {isUnread ? (
                              <span className="notification-unread-dot h-2.5 w-2.5 rounded-full bg-red-500" />
                            ) : null}
                            <h2 className="text-lg font-black tracking-tight text-white">
                              {notification.title}
                            </h2>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-400">
                            {notification.body}
                          </p>
                        </div>
                        {notification.created_at ? (
                          <time className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">
                            {formatNotificationTime(notification.created_at)}
                          </time>
                        ) : null}
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <Link
                          href={notification.action_url || "/"}
                          onClick={() => void openNotification(notification)}
                          className="rounded-full border border-stone-200/30 bg-stone-200 px-5 py-2.5 text-sm font-black text-zinc-950 transition duration-200 hover:-translate-y-0.5 hover:border-stone-100 hover:bg-stone-100"
                        >
                          {notification.action_label || "Open"}
                        </Link>
                        {isUnread ? (
                          <button
                            type="button"
                            onClick={() => void updateNotification(notification.id, "mark_read")}
                            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-bold text-zinc-200 transition duration-200 hover:-translate-y-0.5 hover:border-stone-200/25 hover:bg-zinc-800 hover:text-white"
                          >
                            Mark as read
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void updateNotification(notification.id, "archive")}
                          className="rounded-full px-4 py-2.5 text-sm font-bold text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-900 hover:text-stone-200"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {nextCursor ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void loadNotifications({ append: true, cursor: nextCursor })}
              disabled={isLoadingMore}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-6 py-3 text-sm font-bold text-stone-200 transition hover:border-stone-200/25 hover:bg-zinc-900 disabled:cursor-default disabled:opacity-60"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
