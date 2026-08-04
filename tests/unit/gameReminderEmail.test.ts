import { beforeEach, describe, expect, it, vi } from "vitest";

const sendResendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

import {
  getGameReminderIdempotencyKey,
  isGameReminderEmailEnabled,
  sendGameReminderEmail,
} from "@/lib/email/gameReminder";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.fairplayfootball.co.uk";
  process.env.EMAIL_ENABLE_GAME_REMINDER = "true";
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
});

describe("sendGameReminderEmail", () => {
  it("sends a polished reminder email with game details", async () => {
    await sendGameReminderEmail({
      game: {
        id: 10,
        title: "Friday Football",
        location: "Test Pitch",
        time: "Friday 7pm",
        price: 8,
      },
      recipient: {
        userId: "user-1",
        email: "player@example.com",
        playerName: "Profile Player",
      },
    });

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "player@example.com",
        subject: "Game Reminder: Friday Football",
        idempotencyKey: "game_reminder:game:10:user:user-1",
      })
    );

    const email = sendResendEmailMock.mock.calls[0][0] as {
      html: string;
      text: string;
    };

    expect(email.text).toContain("Hi Profile Player,");
    expect(email.text).toContain("Your game starts soon: Friday Football.");
    expect(email.text).toContain("Arrive 15 minutes before kick-off so the group can start on time.");
    expect(email.text).toContain("Check the game details before you travel.");
    expect(email.text).toContain("Location: Test Pitch");
    expect(email.text).toContain("Kick-off: Friday 7pm");
    expect(email.text).toContain("Price: £8.00");
    expect(email.text).toContain("View game details: https://www.fairplayfootball.co.uk/?open_game_id=10#games");
    expect(email.html).toContain("Game Reminder");
    expect(email.html).toContain("View game details");
    expect(email.html).toContain("Your game starts soon:");
  });

  it("keeps the reminder feature flag and idempotency key stable", () => {
    expect(isGameReminderEmailEnabled()).toBe(true);
    expect(getGameReminderIdempotencyKey(42, "user-2")).toBe("game_reminder:game:42:user:user-2");
  });
});
