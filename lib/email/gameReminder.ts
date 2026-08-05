import "server-only";

import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  getGameUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumGameDetailsCard,
} from "./shared";

export type GameReminderEmailGame = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at?: string | null;
  price: number | string | null;
};

export type SendGameReminderEmailParams = {
  game: GameReminderEmailGame;
  recipient: {
    userId: string;
    email: string;
    playerName: string;
  };
};

export function isGameReminderEmailEnabled() {
  return process.env.EMAIL_ENABLE_GAME_REMINDER === "true";
}

export function getGameReminderIdempotencyKey(gameId: number, userId: string) {
  return `game_reminder:game:${gameId}:user:${userId}`;
}

export async function sendGameReminderEmail({
  game,
  recipient,
}: SendGameReminderEmailParams) {
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const gameUrl = getGameUrl(game.id);
  const subject = "You're Playing Soon ⚽";

  const text = [
    `Hi ${recipient.playerName},`,
    "",
    "Just a reminder that your Fair Play Football game is coming up.",
    "",
    "Game Details",
    `📅 ${kickoff.date}`,
    `🕒 ${kickoff.time}`,
    `📍 ${gameLocation}`,
    "",
    `View Booking: ${gameUrl}`,
    "",
    "Please arrive around 10 minutes before kick-off.",
  ].join("\n");

  const html = renderPremiumEmailLayout({
    previewText: "Just a reminder that your Fair Play Football game is coming up.",
    title: "You're Playing Soon ⚽",
    ctaHref: gameUrl,
    ctaLabel: "View Booking",
    footerText: "Please arrive around 10 minutes before kick-off.",
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(recipient.playerName)},
      </p>
      ${renderEmailParagraphs(["Just a reminder that your Fair Play Football game is coming up."])}
    `,
    cardHtml: renderPremiumGameDetailsCard({
      date: kickoff.date,
      time: kickoff.time,
      venue: gameLocation,
    }),
  });

  return sendResendEmail({
    to: recipient.email,
    subject,
    html,
    text,
    idempotencyKey: getGameReminderIdempotencyKey(game.id, recipient.userId),
  });
}
