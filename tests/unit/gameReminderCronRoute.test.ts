import { beforeEach, describe, expect, it, vi } from "vitest";

const runGameReminderSchedulerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/gameReminderScheduler", () => ({
  runGameReminderScheduler: runGameReminderSchedulerMock,
}));

import { GET } from "@/app/api/cron/game-reminders/route";

function cronRequest(secret?: string) {
  return new Request("http://localhost/api/cron/game-reminders", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  }) as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  runGameReminderSchedulerMock.mockResolvedValue({
    disabled: false,
    gamesChecked: 1,
    deliveriesCreated: 1,
    deliveriesProcessed: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    retried: 0,
  });
});

describe("game reminder cron route", () => {
  it("rejects requests without the cron bearer secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(runGameReminderSchedulerMock).not.toHaveBeenCalled();
  });

  it("rejects requests when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(cronRequest("cron-secret"));

    expect(response.status).toBe(401);
    expect(runGameReminderSchedulerMock).not.toHaveBeenCalled();
  });

  it("runs the scheduler for authenticated cron requests", async () => {
    const response = await GET(cronRequest("cron-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runGameReminderSchedulerMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      disabled: false,
      deliveriesCreated: 1,
      sent: 1,
    });
  });
});
