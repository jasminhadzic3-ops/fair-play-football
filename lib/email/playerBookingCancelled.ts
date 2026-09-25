import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getWalletBalanceBreakdown } from "@/lib/wallet";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatPrice,
  getFirstName as resolveFirstName,
  getSiteUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
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
  return resolveFirstName(playerName);
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
        subject: "Wallet Credit Added",
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
        subject: "Booking Cancelled Within 24 Hours",
        heading: "Cancellation Policy",
        previewText: `Your booking for ${gameTitle} has been cancelled.`,
        paragraphs: [
          `Your booking for ${gameTitle} has been cancelled.`,
          "Because you cancelled your booking within 24 hours of kick-off, you are not eligible for a wallet credit or refund in accordance with the Fair Play Football Cancellation Policy.",
        ],
        exactParagraphs: [
          `Your booking for ${gameTitle} has been cancelled.`,
          "Because you cancelled your booking within 24 hours of kick-off, you are not eligible for a wallet credit or refund in accordance with the Fair Play Football Cancellation Policy.",
        ],
        reason: null,
        ctaLabel: "View Cancellation Policy",
      };
  }
}

export async function sendPlayerBookingCancelledEmail({
  cancellationId,
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
  const cancellationPolicyUrl = `${getSiteUrl()}/#about`;
  const idempotencyKey = `player_booking_cancelled:cancellation:${cancellationId}:outcome:${outcome}`;
  const walletBalanceBreakdown = outcome === "wallet_restored"
    ? await getWalletBalanceBreakdown({ userId, currency: currency || "GBP" })
    : null;
  const walletBalance = walletBalanceBreakdown
    ? formatPrice(walletBalanceBreakdown.availableBalance, currency || "GBP")
    : null;

  const text = outcome === "wallet_restored" ? [
    `Hi ${playerName},`,
    "",
    `We've added ${formattedAmount || "Credit"} to your Fair Play Wallet.`,
    "",
    "You can use your wallet credit to book another game at any time.",
    "",
    "If you'd prefer a refund to your original payment method, you can request one directly from your wallet.",
    "",
    "Wallet Credit",
    `Amount\n${formattedAmount || "Credit"}`,
    "Reason\nPlayer cancellation",
    `Available Balance\n${walletBalance || ""}`,
    "",
    `Open Wallet: ${walletUrl}`,
    "",
    "Thank you for being part of Fair Play Football.",
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n") : [
    `Hi ${playerName},`,
    "",
    `Your booking for ${gameTitle} has been cancelled.`,
    "",
    "Because you cancelled your booking within 24 hours of kick-off, you are not eligible for a wallet credit or refund in accordance with the Fair Play Football Cancellation Policy.",
    "",
    "Cancellation Details",
    `Game\n${gameTitle}`,
    `Date\n${kickoff.date}`,
    `Kick-off\n${kickoff.time}`,
    `Venue\n${gameLocation}`,
    "Status\nNot Eligible for Refund",
    "",
    `View Cancellation Policy: ${cancellationPolicyUrl}`,
    "",
    "We hope to see you at another Fair Play Football game soon.",
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n");

  const html = renderPremiumEmailLayout({
    previewText: outcome === "wallet_restored"
      ? `We've added ${formattedAmount || "Credit"} to your Fair Play Wallet.`
      : outcomeCopy.previewText,
    title: outcome === "wallet_restored" ? "Wallet Credit Added" : outcomeCopy.heading,
    ctaHref: outcome === "wallet_restored" ? walletUrl : cancellationPolicyUrl,
    ctaLabel: outcome === "wallet_restored" ? "Open Wallet" : outcomeCopy.ctaLabel,
    footerText: outcome === "wallet_restored"
      ? "Thank you for being part of Fair Play Football. If you have any questions, we're always happy to help."
      : "We hope to see you at another Fair Play Football game soon. If you have any questions, we're always happy to help.",
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      ${outcome === "wallet_restored" ? `
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          We've added <strong>${escapeHtml(formattedAmount || "Credit")}</strong> to your Fair Play Wallet.
        </p>
        ${renderEmailParagraphs([
          "You can use your wallet credit to book another game at any time.",
          "If you'd prefer a refund to your original payment method, you can request one directly from your wallet.",
        ])}
      ` : `
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          Your booking for <strong>${escapeHtml(gameTitle)}</strong> has been cancelled.
        </p>
        ${renderEmailParagraphs([
          "Because you cancelled your booking within 24 hours of kick-off, you are not eligible for a wallet credit or refund in accordance with the Fair Play Football Cancellation Policy.",
        ])}
      `}
    `,
    cardHtml: outcome === "wallet_restored"
      ? renderPremiumInfoCard("Wallet Credit", [
          { label: "Amount", value: formattedAmount || "Credit" },
          { label: "Reason", value: "Player cancellation" },
          { label: "Available Balance", value: walletBalance || "" },
        ])
      : renderPremiumInfoCard("Cancellation Details", [
          { label: "Game", value: gameTitle },
          { label: "Date", value: kickoff.date },
          { label: "Kick-off", value: kickoff.time },
          { label: "Venue", value: gameLocation },
          { label: "Status", value: "Not Eligible for Refund" },
        ]),
  });

  return sendResendEmail({
    to: recipientEmail,
    subject: outcomeCopy.subject,
    html,
    text,
    idempotencyKey,
  });
}
