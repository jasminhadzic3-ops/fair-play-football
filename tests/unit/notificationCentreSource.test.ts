import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("notification centre source", () => {
  it("uses the approved filters and empty state copy", () => {
    const page = read("components/notifications/NotificationsPageClient.tsx");

    expect(page).toContain('{ id: "refunds", label: "Refunds" }');
    expect(page).not.toContain('label: "Payments"');
    expect(page).toContain("You're all caught up ⚽");
    expect(page).toContain("New booking updates, reminders and wallet activity will appear here.");
  });

  it("caps the bell badge at 99+ and keeps per-notification read actions", () => {
    const bell = read("components/notifications/NotificationBell.tsx");

    expect(bell).toContain('return count > 99 ? "99+" : String(count);');
    expect(bell).toContain("Mark as read");
    expect(bell).toContain("Mark all as read");
  });

  it("keeps notification grouping out of the launch implementation", () => {
    const bell = read("components/notifications/NotificationBell.tsx");
    const page = read("components/notifications/NotificationsPageClient.tsx");

    expect(`${bell}\n${page}`).not.toContain("groupNotifications");
    expect(`${bell}\n${page}`).not.toContain("Grouped notifications");
  });

  it("keeps the schema ready for future email and in-app preferences", () => {
    const sql = read("supabase/migrations/20260805040700_create_notifications.sql");

    expect(sql).toContain("channel text not null default 'in_app'");
    expect(sql).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(sql).toContain("dedupe_key text");
    expect(sql).toContain("'refunds'");
  });

  it("uses the premium notification motion hooks", () => {
    const styles = read("app/globals.css");
    const bell = read("components/notifications/NotificationBell.tsx");
    const page = read("components/notifications/NotificationsPageClient.tsx");

    expect(styles).toContain("@keyframes notification-dropdown-enter");
    expect(styles).toContain("@keyframes notification-card-enter");
    expect(styles).toContain("@keyframes notification-badge-pulse");
    expect(bell).toContain("notification-dropdown-enter");
    expect(bell).toContain("notification-badge");
    expect(page).toContain("notification-card-enter");
  });
});
