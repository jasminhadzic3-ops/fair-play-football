import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getSiteUrl, renderEmailLayout } from "./shared";

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
  formattedAmount: string | null
) {
  const amount = formattedAmount || "your";

  switch (outcome) {
    case "wallet_restored":
      return {
        subjectSuffix: "wallet credit added",
        heading: "Booking Cancelled",
        explanation: `Your booking has been cancelled and ${amount} has been added to your Fair Play Wallet. You can use this credit to book another game straight away. Prefer the money back on your card? Request a refund from your Wallet.`,
      };
    case "no_refund_within_24h":
      return {
        subjectSuffix: "booking cancelled",
        heading: "Booking cancelled",
        explanation: "Your booking has been cancelled. As the cancellation was made within 24 hours of kick-off, no refund is available.",
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
  const outcomeCopy = getOutcomeCopy(outcome, formattedAmount);
  const browseGamesUrl = `${getSiteUrl()}/#games`;
  const subject = `Booking cancelled: ${gameTitle} - ${outcomeCopy.subjectSuffix}`;
  const idempotencyKey = `player_booking_cancelled:cancellation:${cancellationId}:outcome:${outcome}`;

  const text = [
    `Hi ${playerName},`,
    "",
    outcomeCopy.explanation,
    "",
    `Game: ${gameTitle}`,
    `Date: ${kickoff.date}`,
    `Kick-off: ${kickoff.time}`,
    `Location: ${gameLocation}`,
    formattedAmount ? `Refund amount: ${formattedAmount}` : null,
    `Booking ID: ${bookingId}`,
    "",
    `Browse upcoming games: ${browseGamesUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderEmailLayout({
    previewText: outcomeCopy.explanation,
    title: "Booking cancelled",
    ctaHref: browseGamesUrl,
    ctaLabel: "Browse Upcoming Games",
    footerText: "Need help? Reply to this email and Fair Play Football will help.",
    bodyHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      <p style="margin:0 0 10px;font-size:13px;line-height:18px;letter-spacing:0.18em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
        ${escapeHtml(outcomeCopy.heading)}
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        ${escapeHtml(outcomeCopy.explanation)}
      </p>

      <div style="border:1px solid #27272a;background:#111113;border-radius:22px;padding:18px;margin:0 0 22px;">
        <p style="margin:0 0 14px;font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
          Match details
        </p>
        <div style="margin:0;">
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Game:</strong> ${escapeHtml(gameTitle)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Date:</strong> ${escapeHtml(kickoff.date)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Kick-off:</strong> ${escapeHtml(kickoff.time)}</p>
          <p style="margin:0;color:#f4f4f5;"><strong>Location:</strong> ${escapeHtml(gameLocation)}</p>
        </div>
      </div>

      ${
        formattedAmount
          ? `<div style="border-top:1px solid #27272a;padding-top:18px;color:#a1a1aa;font-size:13px;line-height:21px;">
              <p style="margin:0 0 6px;">Refund amount: ${escapeHtml(formattedAmount)}</p>
              <p style="margin:0;">Booking ID: ${bookingId}</p>
            </div>`
          : `<div style="border-top:1px solid #27272a;padding-top:18px;color:#a1a1aa;font-size:13px;line-height:21px;">
              <p style="margin:0;">Booking ID: ${bookingId}</p>
            </div>`
      }
    `,
  });

  return sendResendEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
