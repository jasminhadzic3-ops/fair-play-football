import "server-only";

import { createHash } from "node:crypto";

import { createGameHalfFullNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendEmailWithDeliveryTracking } from "./deliveryTracking";
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

type GameHalfFullEmailParams = {
  gameId: number;
};

type GameEmailData = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
  price: number | null;
  pricing_mode?: "paid" | "free" | null;
  max_players: number | null;
  tags: string[] | null;
};

type ProfileEmailData = {
  id: string;
  email: string | null;
  username: string | null;
};

type EmailRecipient = {
  userId?: string;
  idempotencyRecipientKey: string;
  email: string;
  playerName: string;
};

function isGameHalfFullEmailEnabled() {
  return process.env.EMAIL_ENABLE_GAME_HALF_FULL === "true";
}

function getBroadcastTestRecipient() {
  return process.env.EMAIL_BROADCAST_TEST_RECIPIENT?.trim() || null;
}

function hashRecipientKey(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function getGreetingName(playerName: string) {
  return getFirstName(playerName);
}

async function getGameHalfFullRecipients(): Promise<EmailRecipient[]> {
  const testRecipient = getBroadcastTestRecipient();

  if (testRecipient) {
    return [
      {
        idempotencyRecipientKey: `test:${hashRecipientKey(testRecipient)}`,
        email: testRecipient,
        playerName: "Player",
      },
    ];
  }

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,username")
    .not("email", "is", null);

  if (error) {
    throw error;
  }

  return ((profiles ?? []) as ProfileEmailData[])
    .filter((profile): profile is ProfileEmailData & { email: string } => Boolean(profile.email))
    .map((profile) => ({
      userId: profile.id,
      idempotencyRecipientKey: profile.id,
      email: profile.email,
      playerName: profile.username || "Player",
    }));
}

export async function sendGameHalfFullEmails(params: GameHalfFullEmailParams) {
  if (!isGameHalfFullEmailEnabled()) {
    return { skipped: true, sentCount: 0 };
  }

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,starts_at,price,pricing_mode,max_players,tags")
    .eq("id", params.gameId)
    .maybeSingle<GameEmailData>();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    throw new Error("Unable to send game half full email: game not found.");
  }

  const maxPlayers = Number(game.max_players ?? 0);

  if (!maxPlayers) {
    return { skipped: true, sentCount: 0 };
  }

  const halfFullThreshold = Math.ceil(maxPlayers / 2);
  const { count: bookingCount, error: bookingCountError } = await supabaseAdmin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id);

  if (bookingCountError) {
    throw bookingCountError;
  }

  if ((bookingCount ?? 0) !== halfFullThreshold) {
    return { skipped: true, sentCount: 0 };
  }

  const recipients = await getGameHalfFullRecipients();
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const gamePrice = game.pricing_mode === "free" ? "FREE" : formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = "Game Is Almost Full";
  const gameName = game.title || "";
  const gameType = formatGameType(game.tags);
  let sentCount = 0;

  for (const recipient of recipients) {
    const greetingName = getGreetingName(recipient.playerName);
    const text = [
      `Hi ${greetingName},`,
      "",
      `${gameName} is almost full.`,
      "",
      "There are only a few spots left. If you'd like to play, we recommend booking soon.",
      "",
      "Game Details",
      `Game\n${gameName}`,
      `Date\n${kickoff.date}`,
      `Kick-off\n${kickoff.time}`,
      `Venue\n${gameLocation}`,
      `Game Type\n${gameType}`,
      `Price\n${gamePrice}`,
      "",
      `View Game: ${gameUrl}`,
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
      previewText: `${gameName} is almost full.`,
      title: "Game Almost Full",
      ctaHref: gameUrl,
      ctaLabel: "View Game",
    footerText: "We look forward to seeing you on the pitch. If you have any questions, we're always happy to help.",
    includeCommunityBlocks: true,
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(greetingName)},
        </p>
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          <strong>${escapeHtml(gameName)}</strong> is almost full.
        </p>
        ${renderEmailParagraphs([
          "There are only a few spots left. If you'd like to play, we recommend booking soon.",
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

    const idempotencyKey = `game_half_full:game:${game.id}:recipient:${recipient.idempotencyRecipientKey}`;

    const delivery = await sendEmailWithDeliveryTracking({
      deliveryKey: idempotencyKey,
      emailType: "game_half_full",
      recipientKey: recipient.idempotencyRecipientKey,
      gameId: game.id,
      metadata: {
        half_full_threshold: halfFullThreshold,
      },
      send: () =>
        sendResendEmail({
          to: recipient.email,
          subject,
          html,
          text,
          idempotencyKey,
        }),
    });

    if (!delivery.skipped) {
      if (recipient.userId) {
        await createGameHalfFullNotification({
          recipient: {
            userId: recipient.userId,
            playerName: recipient.playerName,
          },
          game,
        }).catch((notificationError) => {
          console.error("Unable to create game half full notification:", {
            gameId: game.id,
            userId: recipient.userId,
            error: notificationError,
          });
        });
      }

      sentCount += 1;
    }
  }

  return { skipped: false, sentCount };
}
