import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getGameUrl, renderEmailLayout } from "./shared";

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
  const total = formatPrice(params.amount ?? game.price, params.currency);
  const bookingUrl = getGameUrl(params.gameId);
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

  const html = renderEmailLayout({
    previewText: `Your booking is confirmed for ${gameTitle}.`,
    title: "Booking confirmed",
    ctaHref: bookingUrl,
    ctaLabel: "View booking",
    bodyHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        You're booked in for <strong style="color:#ffffff;">${escapeHtml(gameTitle)}</strong>. We'll see you on the pitch.
      </p>

      <div style="border:1px solid #27272a;background:#111113;border-radius:22px;padding:18px;margin:0 0 22px;">
        <p style="margin:0 0 14px;font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
          Match details
        </p>
        <div style="margin:0;">
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Game:</strong> ${escapeHtml(gameTitle)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Location:</strong> ${escapeHtml(gameLocation)}</p>
          <p style="margin:0 0 10px;color:#f4f4f5;"><strong>Kick-off:</strong> ${escapeHtml(gameTime)}</p>
          <p style="margin:0;color:#f4f4f5;"><strong>Total paid:</strong> ${escapeHtml(total)}</p>
        </div>
      </div>

      <div style="border-top:1px solid #27272a;padding-top:18px;color:#a1a1aa;font-size:13px;line-height:21px;">
        <p style="margin:0 0 6px;">Booking ID: ${params.bookingId}</p>
        <p style="margin:0;">Payment ID: ${params.paymentId}</p>
      </div>
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
