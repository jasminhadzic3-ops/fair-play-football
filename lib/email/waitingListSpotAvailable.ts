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
  starts_at: string | null;
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
    throw new Error("Unable to send waiting-list spot email: game not found.");
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send waiting-list spot email: player email not found.");
  }

  const playerName = profile?.username || params.playerName || "Player";
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const gamePrice = formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(params.gameId);
  const subject = "Good News — A Spot Is Available ⚽";
  const idempotencyKey = `waiting_list_spot_available:notification:${params.notificationId}`;

  const text = [
    `Hi ${playerName},`,
    "",
    "A place has become available and you've been invited from the waiting list.",
    "",
    "Your spot isn't reserved until payment is completed.",
    "",
    "Game Details",
    `📅 ${kickoff.date}`,
    `🕒 ${kickoff.time}`,
    `📍 ${gameLocation}`,
    `💷 ${gamePrice}`,
    `Waiting list ID: ${params.waitingListId}`,
    "",
    `Complete Your Booking: ${gameUrl}`,
  ].join("\n");

  const html = renderPremiumEmailLayout({
    previewText: "A place has become available and you've been invited from the waiting list.",
    title: "Good News — A Spot Is Available ⚽",
    ctaHref: gameUrl,
    ctaLabel: "Complete Your Booking",
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(playerName)},
      </p>
      ${renderEmailParagraphs([
        "A place has become available and you've been invited from the waiting list.",
        "Your spot isn't reserved until payment is completed.",
      ])}
    `,
    cardHtml: renderPremiumGameDetailsCard({
      date: kickoff.date,
      time: kickoff.time,
      venue: gameLocation,
      price: gamePrice,
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
