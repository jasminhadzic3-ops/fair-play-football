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
        subject: "You're Playing Soon ⚽",
        idempotencyKey: "game_reminder:game:10:user:user-1",
      })
    );

    const email = sendResendEmailMock.mock.calls[0][0] as {
      html: string;
      text: string;
    };

    expect(email.text).toContain("Hi Profile Player,");
    expect(email.text).toContain("Just a reminder that your Fair Play Football game is coming up.");
    expect(email.text).toContain("📅 Friday 7pm");
    expect(email.text).toContain("🕒 Friday 7pm");
    expect(email.text).toContain("📍 Test Pitch");
    expect(email.text).toContain("View Booking: https://www.fairplayfootball.co.uk/?open_game_id=10#games");
    expect(email.text).toContain("Please arrive around 10 minutes before kick-off.");
    expect(email.html).toContain("You&#039;re Playing Soon ⚽");
    expect(email.html).toContain("View Booking");
    expect(email.html).toContain("booking@fairplayfootball.co.uk");
  });

  it("keeps the reminder feature flag and idempotency key stable", () => {
    expect(isGameReminderEmailEnabled()).toBe(true);
    expect(getGameReminderIdempotencyKey(42, "user-2")).toBe("game_reminder:game:42:user:user-2");
  });
});
