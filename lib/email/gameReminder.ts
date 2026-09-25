import "server-only";

import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  formatGameType,
  formatPrice,
  getCommunityEmailText,
  getFirstName,
  getGameUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumInfoCard,
} from "./shared";

export type GameReminderEmailGame = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at?: string | null;
  price: number | string | null;
  tags?: string[] | null;
  pricing_mode?: "paid" | "free" | null;
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
  const subject = "Ready for Kick-off";
  const gameName = game.title || "";
  const gameType = formatGameType(game.tags);
  const price = game.pricing_mode === "free" ? "FREE" : formatPrice(Number(game.price));
  const firstName = getFirstName(recipient.playerName);

  const text = [
    `Hi ${firstName},`,
    "",
    "Just a quick reminder that your game starts soon.",
    "",
    "Game Details",
    `Game\n${gameName}`,
    `Date\n${kickoff.date}`,
    `Kick-off\n${kickoff.time}`,
    `Venue\n${gameLocation}`,
    `Game Type\n${gameType}`,
    `Price\n${price}`,
    "",
    `View Booking: ${gameUrl}`,
    "",
    ...getCommunityEmailText(),
    "",
    "We look forward to seeing you on the pitch.",
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n");

  const html = renderPremiumEmailLayout({
    previewText: "Just a quick reminder that your game starts soon.",
    title: "Ready for Kick-off",
    ctaHref: gameUrl,
    ctaLabel: "View Booking",
    footerText: "We look forward to seeing you on the pitch. If you have any questions, we're always happy to help.",
    includeCommunityBlocks: true,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(firstName)},
      </p>
      ${renderEmailParagraphs(["Just a quick reminder that your game starts soon."])}
    `,
    cardHtml: renderPremiumInfoCard("Game Details", [
      { label: "Game", value: gameName },
      { label: "Date", value: kickoff.date },
      { label: "Kick-off", value: kickoff.time },
      { label: "Venue", value: gameLocation },
      { label: "Game Type", value: gameType },
      { label: "Price", value: price },
    ]),
  });

  return sendResendEmail({
    to: recipient.email,
    subject,
    html,
    text,
    idempotencyKey: getGameReminderIdempotencyKey(game.id, recipient.userId),
  });
}
