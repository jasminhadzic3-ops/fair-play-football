import "server-only";

import { createHash } from "node:crypto";

import { createGameHalfFullNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendEmailWithDeliveryTracking } from "./deliveryTracking";
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
  max_players: number | null;
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
    .select("id,title,location,time,starts_at,price,max_players")
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
  const gamePrice = formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = "Game Filling Up Fast ⚽";
  let sentCount = 0;

  for (const recipient of recipients) {
    const text = [
      `Hi ${recipient.playerName},`,
      "",
      "This game is already over halfway full.",
      "",
      "If you're planning to play, now's a good time to secure your spot.",
      "",
      "Game Details",
      `📅 ${kickoff.date}`,
      `🕒 ${kickoff.time}`,
      `📍 ${gameLocation}`,
      `💷 ${gamePrice}`,
      "",
      `Book Now: ${gameUrl}`,
    ].join("\n");

    const html = renderPremiumEmailLayout({
      previewText: "This game is already over halfway full.",
      title: "Game Filling Up Fast ⚽",
      ctaHref: gameUrl,
      ctaLabel: "Book Now",
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(recipient.playerName)},
        </p>
        ${renderEmailParagraphs([
          "This game is already over halfway full.",
          "If you're planning to play, now's a good time to secure your spot.",
        ])}
      `,
      cardHtml: renderPremiumGameDetailsCard({
        date: kickoff.date,
        time: kickoff.time,
        venue: gameLocation,
        price: gamePrice,
      }),
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
