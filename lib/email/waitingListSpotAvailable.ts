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
  pricing_mode?: "paid" | "free" | null;
  tags: string[] | null;
};

type ProfileEmailData = {
  email: string | null;
  username: string | null;
};

function getGreetingName(playerName: string) {
  return getFirstName(playerName);
}

export async function sendWaitingListSpotAvailableEmail(params: WaitingListSpotAvailableEmailParams) {
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
    throw new Error("Unable to send waiting-list spot email: game not found.");
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send waiting-list spot email: player email not found.");
  }

  const greetingName = getGreetingName(profile?.username || params.playerName);
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const gamePrice = game.pricing_mode === "free" ? "FREE" : formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(params.gameId);
  const subject = "Spot Available";
  const gameName = game.title || "";
  const gameType = formatGameType(game.tags);
  const idempotencyKey = `waiting_list_spot_available:notification:${params.notificationId}`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `A spot has become available for ${gameName}.`,
    "",
    "If you’d still like to play, you can secure it now before it’s taken.",
    "",
    "Game Details",
    `Game\n${gameName}`,
    `Date\n${kickoff.date}`,
    `Kick-off\n${kickoff.time}`,
    `Venue\n${gameLocation}`,
    `Game Type\n${gameType}`,
    `Price\n${gamePrice}`,
    "",
    `Book Now: ${gameUrl}`,
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
    previewText: `A place has opened for ${gameName}.`,
    title: "A Spot Is Available",
    ctaHref: gameUrl,
    ctaLabel: "Book Now",
    footerText: "We look forward to seeing you on the pitch. If you have any questions, we're always happy to help.",
    includeCommunityBlocks: true,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(greetingName)},
      </p>
      <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
        A spot has become available for <strong>${escapeHtml(gameName)}</strong>.
      </p>
      ${renderEmailParagraphs([
        "If you’d still like to play, you can secure it now before it’s taken.",
      ])}
    `,
    cardHtml: renderPremiumInfoCard("Game Details", [
      { label: "Game", value: gameName },
      { label: "Date", value: kickoff.date },
      { label: "Kick-off", value: kickoff.time },
      { label: "Venue", value: gameLocation },
      { label: "Game Type", value: gameType },
      { label: "Price", value: gamePrice },
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
