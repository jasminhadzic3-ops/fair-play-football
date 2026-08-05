import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatPrice,
  getSiteUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumGameDetailsCard,
  renderPremiumInfoCard,
} from "./shared";

export type PlayerBookingCancellationEmailOutcome =
  | "wallet_restored"
  | "no_refund_within_24h";

type SendPlayerBookingCancelledEmailParams = {
  cancellationId: number;
  bookingId: number;
  gameId: number;
  userId: string;
  outcome: PlayerBookingCancellationEmailOutcome;
  amount: number | null;
  currency: string | null;
};

type GameEmailData = {
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
};

type ProfileEmailData = {
  email: string | null;
  username: string | null;
};

const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const londonTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getFirstName(playerName: string | null | undefined) {
  return playerName?.trim().split(/\s+/)[0] || "Player";
}

function getKickoffDetails(game: GameEmailData) {
  if (!game.starts_at) {
    return {
      date: game.time || "TBD",
      time: game.time || "TBD",
    };
  }

  const startsAt = new Date(game.starts_at);

  if (Number.isNaN(startsAt.getTime())) {
    return {
      date: game.time || "TBD",
      time: game.time || "TBD",
    };
  }

  return {
    date: londonDateFormatter.format(startsAt),
    time: londonTimeFormatter.format(startsAt),
  };
}

function getOutcomeCopy(
  outcome: PlayerBookingCancellationEmailOutcome,
  formattedAmount: string | null,
  gameTitle: string
) {
  const amount = formattedAmount || "Credit";

  switch (outcome) {
    case "wallet_restored":
      return {
        subject: "Credit Added To Your Wallet",
        heading: "Credit Added To Your Wallet",
        previewText: `${amount} has been added to your Fair Play Wallet.`,
        paragraphs: [
          `${amount} has been added to your Fair Play Wallet and is ready to use.`,
        ],
        exactParagraphs: [
          `${amount} has been added to your Fair Play Wallet.`,
        ],
        reason: "Player cancellation",
        ctaLabel: "View Wallet",
      };
    case "no_refund_within_24h":
      return {
        subject: `Booking Cancelled: ${gameTitle}`,
        heading: "Booking Cancelled",
        previewText: "Your booking has been cancelled. No wallet credit is available within 24 hours of kick-off.",
        paragraphs: [
          `Your booking for ${gameTitle} has been cancelled.`,
          "No wallet credit or refund is available because the booking was cancelled within 24 hours of kick-off.",
        ],
        exactParagraphs: [
          `Your booking for ${gameTitle} has been cancelled.`,
          "No wallet credit or refund is available because the booking was cancelled within 24 hours of kick-off.",
        ],
        reason: null,
        ctaLabel: "View Wallet",
      };
  }
}

export async function sendPlayerBookingCancelledEmail({
  cancellationId,
  bookingId,
  gameId,
  userId,
  outcome,
  amount,
  currency,
}: SendPlayerBookingCancelledEmailParams) {
  const [{ data: game, error: gameError }, { data: profile, error: profileError }, { data: authUser, error: authError }] =
    await Promise.all([
      supabaseAdmin
        .from("games")
        .select("title,location,time,starts_at")
        .eq("id", gameId)
        .maybeSingle<GameEmailData>(),
      supabaseAdmin
        .from("profiles")
        .select("email,username")
        .eq("id", userId)
        .maybeSingle<ProfileEmailData>(),
      supabaseAdmin.auth.admin.getUserById(userId),
    ]);

  if (gameError) {
    throw gameError;
  }

  if (profileError) {
    throw profileError;
  }

  if (authError) {
    throw authError;
  }

  if (!game) {
    throw new Error("Unable to send cancellation email: game not found.");
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send cancellation email: player email not found.");
  }

  const playerName = getFirstName(profile?.username);
  const gameTitle = game.title || "Your football match";
  const gameLocation = game.location || "TBD";
  const kickoff = getKickoffDetails(game);
  const formattedAmount = amount === null ? null : formatPrice(amount, currency || "GBP");
  const outcomeCopy = getOutcomeCopy(outcome, formattedAmount, gameTitle);
  const walletUrl = `${getSiteUrl()}/wallet`;
  const idempotencyKey = `player_booking_cancelled:cancellation:${cancellationId}:outcome:${outcome}`;

  const text = [
    `Hi ${playerName},`,
    "",
    ...(outcomeCopy.exactParagraphs ?? outcomeCopy.paragraphs).flatMap((paragraph) => [paragraph, ""]),
    outcomeCopy.reason ? "Reason" : null,
    outcomeCopy.reason,
    "",
    outcomeCopy.reason ? null : "Game Details",
    outcomeCopy.reason ? null : `📅 ${kickoff.date}`,
    outcomeCopy.reason ? null : `🕒 ${kickoff.time}`,
    outcomeCopy.reason ? null : `📍 ${gameLocation}`,
    `Booking ID: ${bookingId}`,
    "",
    `${outcomeCopy.ctaLabel}: ${walletUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderPremiumEmailLayout({
    previewText: outcomeCopy.previewText,
    title: outcomeCopy.heading,
    ctaHref: walletUrl,
    ctaLabel: outcomeCopy.ctaLabel,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      ${renderEmailParagraphs(outcomeCopy.exactParagraphs ?? outcomeCopy.paragraphs)}
    `,
    cardHtml: outcomeCopy.reason
      ? renderPremiumInfoCard("Reason", [{ value: outcomeCopy.reason }])
      : renderPremiumGameDetailsCard({
          date: kickoff.date,
          time: kickoff.time,
          venue: gameLocation,
        }),
  });

  return sendResendEmail({
    to: recipientEmail,
    subject: outcomeCopy.subject,
    html,
    text,
    idempotencyKey,
  });
}
