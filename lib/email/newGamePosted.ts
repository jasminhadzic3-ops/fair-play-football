import "server-only";

import { createNewGameAvailableNotification } from "@/lib/notifications";
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

type NewGamePostedEmailParams = {
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

function isNewGameEmailEnabled() {
  return process.env.EMAIL_ENABLE_NEW_GAME === "true";
}

function getBroadcastTestRecipient() {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return process.env.EMAIL_BROADCAST_TEST_RECIPIENT?.trim() || null;
}

function getGreetingName(playerName: string) {
  return getFirstName(playerName);
}

async function getTestRecipientProfile(testRecipient: string) {
  const normalizedEmail = testRecipient.trim().toLowerCase();
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,username")
    .ilike("email", normalizedEmail)
    .limit(1);

  if (error) {
    throw error;
  }

  return ((profiles ?? []) as ProfileEmailData[]).find(
    (profile) => profile.email?.trim().toLowerCase() === normalizedEmail
  );
}

async function getNewGameRecipients(): Promise<EmailRecipient[]> {
  const testRecipient = getBroadcastTestRecipient();

  if (testRecipient) {
    const profile = await getTestRecipientProfile(testRecipient);

    return [
      {
        userId: profile?.id,
        idempotencyRecipientKey: testRecipient.toLowerCase(),
        email: testRecipient,
        playerName: profile?.username?.trim() || "there",
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
      playerName: profile.username || "there",
    }));
}

export async function sendNewGamePostedEmails(params: NewGamePostedEmailParams) {
  if (!isNewGameEmailEnabled()) {
    return { skipped: true, sentCount: 0 };
  }

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
        .select("id,title,location,time,starts_at,price,pricing_mode,tags")
    .eq("id", params.gameId)
    .maybeSingle<GameEmailData>();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    throw new Error("Unable to send new game email: game not found.");
  }

  const recipients = await getNewGameRecipients();
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const gamePrice = game.pricing_mode === "free" ? "FREE" : formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = "New Game Available";
  const gameName = game.title || "";
  const gameType = formatGameType(game.tags);
  let sentCount = 0;

  for (const recipient of recipients) {
    const greetingName = getGreetingName(recipient.playerName);
    const text = [
      `Hi ${greetingName},`,
      "",
      "A new Fair Play Football game is now available.",
      "",
      "If you'd like to play, you can book your spot in just a few clicks.",
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
      previewText: "A new Fair Play Football game is ready to book.",
      title: "New Game Available",
      ctaHref: gameUrl,
      ctaLabel: "View Game",
      footerText: "We look forward to seeing you on the pitch. If you have any questions, we're always happy to help.",
      includeCommunityBlocks: true,
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(greetingName)},
        </p>
        ${renderEmailParagraphs([
          "A new Fair Play Football game is now available.",
          "If you'd like to play, you can book your spot in just a few clicks.",
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

    await sendResendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      idempotencyKey: `new_game_posted:game:${game.id}:recipient:${recipient.idempotencyRecipientKey}`,
    });

    if (recipient.userId) {
      await createNewGameAvailableNotification({
        recipient: {
          userId: recipient.userId,
          playerName: recipient.playerName,
        },
        game,
      }).catch((notificationError) => {
        console.error("Unable to create new game notification:", {
          gameId: game.id,
          userId: recipient.userId,
          error: notificationError,
        });
      });
    }

    sentCount += 1;
  }

  return { skipped: false, sentCount };
}
