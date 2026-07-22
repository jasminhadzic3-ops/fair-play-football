import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("game reminder cron configuration", () => {
  it("registers the authenticated reminder cron endpoint", () => {
    const vercelConfig = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8"));

    expect(vercelConfig.crons).toEqual([
      {
        path: "/api/cron/game-reminders",
        schedule: "5 9 * * *",
      },
    ]);
  });

  it("keeps reminder scheduling server-side and protected", () => {
    const routeSource = readFileSync(
      join(repoRoot, "app/api/cron/game-reminders/route.ts"),
      "utf8"
    );
    const schedulerSource = readFileSync(join(repoRoot, "lib/gameReminderScheduler.ts"), "utf8");
    const emailSource = readFileSync(join(repoRoot, "lib/email/gameReminder.ts"), "utf8");

    expect(routeSource).toContain("CRON_SECRET");
    expect(routeSource).toContain("authorization");
    expect(routeSource).toContain('"Cache-Control": "no-store"');
    expect(schedulerSource).toContain('import "server-only"');
    expect(emailSource).toContain('import "server-only"');
    expect(schedulerSource).toContain("game_reminder_deliveries");
    expect(schedulerSource).toContain("sendGameReminderEmail");
    expect(schedulerSource).toContain("const reminderWindowStartHours = 6");
    expect(schedulerSource).toContain("const reminderWindowEndHours = 36");
    expect(schedulerSource).toContain("const minHoursBeforeKickoff = 6");
    expect(schedulerSource).not.toContain("EMAIL_BROADCAST_TEST_RECIPIENT");
  });
});
