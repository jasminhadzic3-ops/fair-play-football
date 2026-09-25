import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

type BookingConfirmedEmailParams = {
  bookingId: number;
  paymentId: number | null;
  paymentMethod?: "sumup" | "wallet" | "free";
  userId: string;
  gameId: number;
  playerName: string;
  amount?: number | null;
  currency?: string | null;
  checkoutId?: string | null;
  checkoutReference?: string | null;
};

type GameEmailData = {
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
  price: number | null;
  pricing_mode?: "paid" | "free" | null;
  tags: string[] | null;
};

type ProfileEmailData = {
  email: string | null;
  username: string | null;
};

export async function sendBookingConfirmedEmail(params: BookingConfirmedEmailParams) {
  const [{ data: game, error: gameError }, { data: profile, error: profileError }, { data: authUser, error: authError }] =
    await Promise.all([
      supabaseAdmin
        .from("games")
        .select("title,location,time,starts_at,price,pricing_mode,tags")
        .eq("id", params.gameId)
        .maybeSingle<GameEmailData>(),
      supabaseAdmin
        .from("profiles")
        .select("email,username")
        .eq("id", params.userId)
        .maybeSingle<ProfileEmailData>(),
      supabaseAdmin.auth.admin.getUserById(params.userId),
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
    throw new Error("Unable to send booking confirmation email: game not found.");
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send booking confirmation email: player email not found.");
  }

  const playerName = getFirstName(profile?.username || params.playerName);
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const isFreeBooking = params.paymentMethod === "free" || game.pricing_mode === "free";
  const total = isFreeBooking ? "FREE" : formatPrice(params.amount ?? game.price, params.currency);
  const bookingUrl = getGameUrl(params.gameId);
  const subject = "Booking Confirmed";
  const isWalletBooking = !isFreeBooking && !params.checkoutId && !params.checkoutReference;
  const gameName = game.title || "";
  const gameType = formatGameType(game.tags);
  const idempotencyKey = `booking_confirmed:booking:${params.bookingId}`;

  const text = [
    `Hi ${playerName},`,
    "",
    `You're booked in for ${gameName}.`,
    "",
    "Your spot is confirmed and everything is set.",
    isFreeBooking ? "This game is free — no payment was required." : isWalletBooking ? "Your booking was paid using your Fair Play Wallet." : null,
    "",
    "Game Details",
    `Game\n${gameName}`,
    `Date\n${kickoff.date}`,
    `Kick-off\n${kickoff.time}`,
    `Venue\n${gameLocation}`,
    `Game Type\n${gameType}`,
    `Price\n${total}`,
    "",
    `View Booking: ${bookingUrl}`,
    "",
    ...getCommunityEmailText(),
    "",
    "We look forward to seeing you on the pitch.",
    "",
    "If you have any questions, we’re always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderPremiumEmailLayout({
    previewText: `You're booked in for ${gameName}.`,
    title: "Your Spot Is Confirmed",
    ctaHref: bookingUrl,
    ctaLabel: "View Booking",
    footerText: "We look forward to seeing you on the pitch. If you have any questions, we're always happy to help.",
    includeCommunityBlocks: true,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
        You're booked in for <strong>${escapeHtml(gameName)}</strong>.
      </p>
      ${renderEmailParagraphs([
        "Your spot is confirmed and everything is set.",
        ...(isFreeBooking ? ["This game is free — no payment was required."] : isWalletBooking ? ["Your booking was paid using your Fair Play Wallet."] : []),
      ])}
    `,
    cardHtml: renderPremiumInfoCard("Game Details", [
      { label: "Game", value: gameName },
      { label: "Date", value: kickoff.date },
      { label: "Kick-off", value: kickoff.time },
      { label: "Venue", value: gameLocation },
      { label: "Game Type", value: gameType },
      { label: "Price", value: total },
    ]),
  });

  return sendResendEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
