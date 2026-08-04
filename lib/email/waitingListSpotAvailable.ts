import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getGameUrl, renderEmailLayout } from "./shared";

type WaitingListSpotAvailableEmailParams = {
  notificationId: number;
  waitingListId: number;
  userId: string;
  gameId: number;
  playerName: string;
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

export async function sendWaitingListSpotAvailableEmail(params: WaitingListSpotAvailableEmailParams) {
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
    throw new Error("Unable to send waiting-list spot email: game not found.");
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send waiting-list spot email: player email not found.");
  }

  const playerName = profile?.username || params.playerName || "Player";
  const gameTitle = game.title || "Your football match";
  const gameLocation = game.location || "TBD";
  const gameTime = game.time || "TBD";
  const gamePrice = formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(params.gameId);
  const subject = `Place Available: ${gameTitle}`;
  const idempotencyKey = `waiting_list_spot_available:notification:${params.notificationId}`;

  const text = [
    `Hi ${playerName},`,
    "",
    `A place is available for ${gameTitle}.`,
    "",
    "Open the game to book your place.",
    "",
    "It is not reserved. Places are first paid, first confirmed.",
    "",
    `Location: ${gameLocation}`,
    `Kick-off: ${gameTime}`,
    `Price: ${gamePrice}`,
    `Waiting list ID: ${params.waitingListId}`,
    "",
    `View game details: ${gameUrl}`,
  ].join("\n");

  const html = renderEmailLayout({
    previewText: `A place is available for ${gameTitle}. It is first paid, first confirmed.`,
    title: "Place Available",
    ctaHref: gameUrl,
    ctaLabel: "View game details",
    bodyHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      <p style="margin:0 0 18px;color:#d4d4d8;">
        A place is available for <strong style="color:#ffffff;">${escapeHtml(gameTitle)}</strong>.
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        Open the game to book your place.
      </p>
      <p style="margin:0 0 22px;color:#d4d4d8;">
        It is not reserved. Places are <strong style="color:#ffffff;">first paid, first confirmed</strong>.
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

      <div style="border-top:1px solid #27272a;padding-top:18px;color:#a1a1aa;font-size:13px;line-height:21px;">
        <p style="margin:0;">Waiting list ID: ${params.waitingListId}</p>
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
