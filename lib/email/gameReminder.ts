import "server-only";

import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getGameUrl, renderEmailLayout } from "./shared";

export type GameReminderEmailGame = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
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
  const gameTitle = game.title || "Your football match";
  const gameLocation = game.location || "TBD";
  const gameTime = game.time || "TBD";
  const gamePrice = formatPrice(Number(game.price ?? 0), "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = `Game Reminder: ${gameTitle}`;

  const text = [
    `Hi ${recipient.playerName},`,
    "",
    `Your game starts soon: ${gameTitle}.`,
    "",
    "Arrive 15 minutes before kick-off so the group can start on time.",
    "",
    "Check the game details before you travel.",
    "",
    `Game: ${gameTitle}`,
    `Location: ${gameLocation}`,
    `Kick-off: ${gameTime}`,
    `Price: ${gamePrice}`,
    "",
    `View game details: ${gameUrl}`,
  ].join("\n");

  const html = renderEmailLayout({
    previewText: `Your game starts soon: ${gameTitle}.`,
    title: "Game Reminder",
    ctaHref: gameUrl,
    ctaLabel: "View game details",
    bodyHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(recipient.playerName)},
      </p>
      <p style="margin:0 0 18px;color:#d4d4d8;">
        Your game starts soon: <strong style="color:#ffffff;">${escapeHtml(gameTitle)}</strong>.
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        Arrive 15 minutes before kick-off so the group can start on time.
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        Check the game details before you travel.
      </p>

      <div style="border:1px solid #27272a;background:#111113;border-radius:22px;padding:18px;margin:0 0 22px;">
        <p style="margin:0 0 14px;font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
          Match details
        </p>
        <div style="margin:0;">
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Game:</strong> ${escapeHtml(gameTitle)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Location:</strong> ${escapeHtml(gameLocation)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Kick-off:</strong> ${escapeHtml(gameTime)}</p>
          <p style="margin:0;color:#f4f4f5;"><strong>Price:</strong> ${escapeHtml(gamePrice)}</p>
        </div>
      </div>
    `,
  });

  return sendResendEmail({
    to: recipient.email,
    subject,
    html,
    text,
    idempotencyKey: getGameReminderIdempotencyKey(game.id, recipient.userId),
  });
}
