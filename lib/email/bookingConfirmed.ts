import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  formatPrice,
  getGameUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumGameDetailsCard,
} from "./shared";

type BookingConfirmedEmailParams = {
  bookingId: number;
  paymentId: number;
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
        .select("title,location,time,starts_at,price")
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

  const playerName = profile?.username || params.playerName || "Player";
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const total = formatPrice(params.amount ?? game.price, params.currency);
  const bookingUrl = getGameUrl(params.gameId);
  const subject = "You're Booked In ⚽";
  const idempotencyKey = `booking_confirmed:booking:${params.bookingId}`;

  const text = [
    `Hi ${playerName},`,
    "",
    "Your spot is confirmed — we'll see you on the pitch. ⚽",
    "",
    "Game Details",
    `📅 ${kickoff.date}`,
    `🕒 ${kickoff.time}`,
    `📍 ${gameLocation}`,
    `💷 ${total}`,
    `Booking ID: ${params.bookingId}`,
    `Payment ID: ${params.paymentId}`,
    params.checkoutId ? `Checkout ID: ${params.checkoutId}` : null,
    params.checkoutReference ? `Checkout reference: ${params.checkoutReference}` : null,
    "",
    `View Your Booking: ${bookingUrl}`,
    "",
    "We'll send you a reminder before kick-off.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderPremiumEmailLayout({
    previewText: "Your spot is confirmed — we'll see you on the pitch. ⚽",
    title: "You're Booked In ⚽",
    ctaHref: bookingUrl,
    ctaLabel: "View Your Booking",
    footerText: "We'll send you a reminder before kick-off.",
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      ${renderEmailParagraphs(["Your spot is confirmed — we'll see you on the pitch. ⚽"])}
    `,
    cardHtml: renderPremiumGameDetailsCard({
      date: kickoff.date,
      time: kickoff.time,
      venue: gameLocation,
      price: total,
    }),
  });

  return sendResendEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
