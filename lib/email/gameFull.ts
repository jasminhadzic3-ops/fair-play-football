import "server-only";

import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendEmailWithDeliveryTracking } from "./deliveryTracking";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  formatPrice,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumInfoCard,
} from "./shared";

const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/JAGpOaEd8jf2njevCRK7JE?mode=gi_t";

type GameFullEmailParams = { gameId: number };

type GameEmailData = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
  price: number | null;
  pricing_mode: "paid" | "free" | null;
  max_players: number | null;
  tags: string[] | null;
};

type BookingRow = { user_id: string | null };
type ProfileRow = { id: string; email: string | null; username: string | null };

type EmailRecipient = {
  userId?: string;
  recipientKey: string;
  email: string;
  playerName: string;
};

function getBroadcastTestRecipient() {
  return process.env.EMAIL_BROADCAST_TEST_RECIPIENT?.trim() || null;
}

function hashRecipientKey(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function getGreetingName(playerName: string) {
  return playerName.trim().split(/\s+/)[0] || "Player";
}

async function getRecipients(bookings: BookingRow[]): Promise<EmailRecipient[]> {
  const testRecipient = getBroadcastTestRecipient();

  if (testRecipient) {
    return [{
      recipientKey: `test:${hashRecipientKey(testRecipient)}`,
      email: testRecipient,
      playerName: "Player",
    }];
  }

  const userIds = [...new Set(bookings.map((booking) => booking.user_id).filter((id): id is string => Boolean(id)))];

  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,username")
    .in("id", userIds)
    .not("email", "is", null);

  if (error) {
    throw error;
  }

  return ((profiles ?? []) as ProfileRow[])
    .filter((profile): profile is ProfileRow & { email: string } => Boolean(profile.email))
    .map((profile) => ({
      userId: profile.id,
      recipientKey: profile.id,
      email: profile.email,
      playerName: profile.username || "Player",
    }));
}

export async function sendGameFullEmails({ gameId }: GameFullEmailParams) {
  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,starts_at,price,pricing_mode,max_players,tags")
    .eq("id", gameId)
    .maybeSingle<GameEmailData>();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    throw new Error("Unable to send game full email: game not found.");
  }

  const maxPlayers = Number(game.max_players ?? 0);

  if (!maxPlayers) {
    return { skipped: true, sentCount: 0 };
  }

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from("bookings")
    .select("user_id")
    .eq("game_id", game.id);

  if (bookingsError) {
    throw bookingsError;
  }

  const confirmedBookings = (bookings ?? []) as BookingRow[];

  if (confirmedBookings.length !== maxPlayers) {
    return { skipped: true, sentCount: 0 };
  }

  const recipients = await getRecipients(confirmedBookings);
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const venue = game.location || "TBD";
  const gameName = game.title || "Fair Play Football game";
  const gameType = (game.tags ?? []).join(", ") || "Fair Play Football";
  const isFreeGame = game.pricing_mode === "free";
  const price = isFreeGame ? "FREE" : formatPrice(game.price, "GBP");
  const subject = `Game On — ${venue}, ${kickoff.time}`;
  let sentCount = 0;

  for (const recipient of recipients) {
    const greetingName = getGreetingName(recipient.playerName);
    const text = [
      `Hi ${greetingName},`,
      "",
      "GAME ON",
      "",
      "Thanks for booking with Fair Play. This game is now full and ready to go.",
      "",
      isFreeGame ? "FREE GAME" : "PAID GAME",
      `Game\n${gameName}`,
      `Date\n${kickoff.date}`,
      `Kick-off\n${kickoff.time}`,
      `Venue\n${venue}`,
      `Game Type\n${gameType}`,
      `Price\n${price}`,
      "",
      "Please arrive 10–15 minutes before kick-off.",
      "",
      "MATCH REMINDERS",
      "• Respect everyone on the pitch and enjoy the game.",
      "• No slide tackles.",
      "• Goalkeeper rotates every 8 minutes.",
      "• No back-passes to the goalkeeper.",
      "• No metal studs — astro trainers or moulded boots only.",
      "• Keep everyone involved in the game.",
      "",
      "STAY IN THE LOOP",
      "The game is full. Join the Fair Play WhatsApp group for upcoming games, availability and community updates.",
      "",
      `Join the WhatsApp group: ${WHATSAPP_GROUP_URL}`,
      "",
      "Thanks for playing with Fair Play. See you on the pitch.",
      "",
      "booking@fairplayfootball.co.uk",
      "© Fair Play Football",
    ].join("\n");

    const html = renderPremiumEmailLayout({
      previewText: "Your game is full and confirmed. Please arrive 10–15 minutes early.",
      title: "GAME ON",
      ctaHref: WHATSAPP_GROUP_URL,
      ctaLabel: "Join the WhatsApp group",
      footerText: "Thanks for playing with Fair Play. See you on the pitch.",
      showCopyright: true,
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">Hi ${escapeHtml(greetingName)},</p>
        ${renderEmailParagraphs([
          "Thanks for booking with Fair Play. This game is now full and ready to go.",
          "Please arrive 10–15 minutes before kick-off.",
        ])}
        <p style="margin:22px 0 10px;color:#d6d3d1;font-size:12px;line-height:18px;font-weight:800;letter-spacing:0.22em;">MATCH REMINDERS</p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#d4d4d8;font-size:15px;line-height:24px;">
          <li>Respect everyone on the pitch and enjoy the game.</li>
          <li>No slide tackles.</li>
          <li>Goalkeeper rotates every 8 minutes.</li>
          <li>No back-passes to the goalkeeper.</li>
          <li>No metal studs — astro trainers or moulded boots only.</li>
          <li>Keep everyone involved in the game.</li>
        </ul>
        <p style="margin:22px 0 10px;color:#d6d3d1;font-size:12px;line-height:18px;font-weight:800;letter-spacing:0.22em;">STAY IN THE LOOP</p>
        ${renderEmailParagraphs([
          "The game is full. Join the Fair Play WhatsApp group for upcoming games, availability and community updates.",
        ])}
      `,
      cardHtml: renderPremiumInfoCard("Game Details", [
        { label: "Game", value: gameName },
        { label: "Date", value: kickoff.date },
        { label: "Kick-off", value: kickoff.time },
        { label: "Venue", value: venue },
        { label: "Game Type", value: isFreeGame ? "FREE GAME" : gameType },
        { label: "Price", value: price },
      ]),
    });

    const delivery = await sendEmailWithDeliveryTracking({
      deliveryKey: `game_full:game:${game.id}:recipient:${recipient.recipientKey}`,
      emailType: "game_full",
      recipientKey: recipient.recipientKey,
      gameId: game.id,
      metadata: { capacity: maxPlayers },
      send: () => sendResendEmail({
        to: recipient.email,
        subject,
        html,
        text,
        idempotencyKey: `game_full:game:${game.id}:recipient:${recipient.recipientKey}`,
      }),
    });

    if (!delivery.skipped) {
      sentCount += 1;
    }
  }

  return { skipped: false, sentCount };
}
