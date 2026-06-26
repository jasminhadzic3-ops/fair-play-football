import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getGameUrl, renderEmailLayout } from "./shared";

type NewGamePostedEmailParams = {
  gameId: number;
};

type GameEmailData = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  price: number | null;
};

type ProfileEmailData = {
  id: string;
  email: string | null;
  username: string | null;
};

type EmailRecipient = {
  idempotencyRecipientKey: string;
  email: string;
  playerName: string;
};

function isNewGameEmailEnabled() {
  return process.env.EMAIL_ENABLE_NEW_GAME === "true";
}

function getBroadcastTestRecipient() {
  return process.env.EMAIL_BROADCAST_TEST_RECIPIENT?.trim() || null;
}

async function getNewGameRecipients(): Promise<EmailRecipient[]> {
  const testRecipient = getBroadcastTestRecipient();

  if (testRecipient) {
    return [
      {
        idempotencyRecipientKey: testRecipient.toLowerCase(),
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
      idempotencyRecipientKey: profile.id,
      email: profile.email,
      playerName: profile.username || "Player",
    }));
}

export async function sendNewGamePostedEmails(params: NewGamePostedEmailParams) {
  if (!isNewGameEmailEnabled()) {
    return { skipped: true, sentCount: 0 };
  }

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id,title,location,time,price")
    .eq("id", params.gameId)
    .maybeSingle<GameEmailData>();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    throw new Error("Unable to send new game email: game not found.");
  }

  const recipients = await getNewGameRecipients();
  const gameTitle = game.title || "New football match";
  const gameLocation = game.location || "TBD";
  const gameTime = game.time || "TBD";
  const gamePrice = formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = `New game available: ${gameTitle}`;
  let sentCount = 0;

  for (const recipient of recipients) {
    const text = [
      `Hi ${recipient.playerName},`,
      "",
      "A new game has been added to Fair Play Football.",
      "",
      `Click "View game" to book your spot if you'd like to join.`,
      "",
      "Places are confirmed on a first paid, first served basis.",
      "",
      `Game: ${gameTitle}`,
      `Location: ${gameLocation}`,
      `Kick-off: ${gameTime}`,
      `Price: ${gamePrice}`,
      "",
      `View game: ${gameUrl}`,
    ].join("\n");

    const html = renderEmailLayout({
      previewText: `A new game has been added to Fair Play Football: ${gameTitle}.`,
      title: "New game available",
      ctaHref: gameUrl,
      ctaLabel: "View game",
      bodyHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(recipient.playerName)},
        </p>
        <p style="margin:0 0 18px;color:#d4d4d8;">
          A new game has been added to Fair Play Football.
        </p>
        <p style="margin:0 0 22px;color:#d4d4d8;">
          Click <strong style="color:#ffffff;">"View game"</strong> to book your spot if you'd like to join.
        </p>
        <p style="margin:0 0 22px;color:#d4d4d8;">
          Places are confirmed on a <strong style="color:#ffffff;">first paid, first served</strong> basis.
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
      `,
    });

    await sendResendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      idempotencyKey: `new_game_posted:game:${game.id}:recipient:${recipient.idempotencyRecipientKey}`,
    });

    sentCount += 1;
  }

  return { skipped: false, sentCount };
}
