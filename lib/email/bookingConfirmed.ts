import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";

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
  price: number | null;
};

type ProfileEmailData = {
  email: string | null;
  username: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSiteUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL is required.");
  }

  return siteUrl.replace(/\/$/, "");
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined) {
  const normalizedAmount = Number(amount ?? 0);
  const normalizedCurrency = currency || "GBP";

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(normalizedAmount);
  } catch {
    return `${normalizedCurrency} ${normalizedAmount.toFixed(2)}`;
  }
}

function buildBookingUrl(gameId: number) {
  return `${getSiteUrl()}/?open_game_id=${encodeURIComponent(String(gameId))}#games`;
}

export async function sendBookingConfirmedEmail(params: BookingConfirmedEmailParams) {
  const [{ data: game, error: gameError }, { data: profile, error: profileError }, { data: authUser, error: authError }] =
    await Promise.all([
      supabaseAdmin
        .from("games")
        .select("title,location,time,price")
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
  const gameTitle = game.title || "Your football match";
  const gameLocation = game.location || "TBD";
  const gameTime = game.time || "TBD";
  const total = formatMoney(params.amount ?? game.price, params.currency);
  const bookingUrl = buildBookingUrl(params.gameId);
  const subject = `Booking confirmed: ${gameTitle}`;
  const idempotencyKey = `booking_confirmed:booking:${params.bookingId}`;

  const text = [
    `Hi ${playerName},`,
    "",
    `Your booking is confirmed for ${gameTitle}.`,
    "",
    `Location: ${gameLocation}`,
    `Kick-off: ${gameTime}`,
    `Total paid: ${total}`,
    `Booking ID: ${params.bookingId}`,
    `Payment ID: ${params.paymentId}`,
    params.checkoutId ? `Checkout ID: ${params.checkoutId}` : null,
    params.checkoutReference ? `Checkout reference: ${params.checkoutReference}` : null,
    "",
    `View your booking: ${bookingUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #18181b; line-height: 1.6;">
      <h1 style="margin: 0 0 16px;">Booking confirmed</h1>
      <p>Hi ${escapeHtml(playerName)},</p>
      <p>Your booking is confirmed for <strong>${escapeHtml(gameTitle)}</strong>.</p>
      <ul>
        <li><strong>Location:</strong> ${escapeHtml(gameLocation)}</li>
        <li><strong>Kick-off:</strong> ${escapeHtml(gameTime)}</li>
        <li><strong>Total paid:</strong> ${escapeHtml(total)}</li>
        <li><strong>Booking ID:</strong> ${params.bookingId}</li>
        <li><strong>Payment ID:</strong> ${params.paymentId}</li>
      </ul>
      <p>
        <a href="${escapeHtml(bookingUrl)}" style="color: #18181b; font-weight: 700;">
          View your booking
        </a>
      </p>
    </div>
  `;

  return sendResendEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
