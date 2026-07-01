import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getGameUrl, renderEmailLayout } from "./shared";

type GameCancelledEmailParams = {
  gameId: number;
};

type GameEmailData = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  price: number | null;
};

type BookingEmailData = {
  user_id: string | null;
  player_name: string | null;
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

function isGameCancelledEmailEnabled() {
  return process.env.EMAIL_ENABLE_GAME_CANCELLED === "true";
}

function getBroadcastTestRecipient() {
  return process.env.EMAIL_BROADCAST_TEST_RECIPIENT?.trim() || null;
}

async function getGameCancelledRecipients(gameId: number): Promise<EmailRecipient[]> {
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

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from("bookings")
    .select("user_id,player_name")
    .eq("game_id", gameId);

  if (bookingsError) {
    throw bookingsError;
  }

  const bookingsByUserId = new Map<string, BookingEmailData>();

  for (const booking of (bookings ?? []) as BookingEmailData[]) {
    if (booking.user_id && !bookingsByUserId.has(booking.user_id)) {
      bookingsByUserId.set(booking.user_id, booking);
    }
  }

  const userIds = Array.from(bookingsByUserId.keys());

  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id,email,username")
    .in("id", userIds);

  if (profilesError) {
    throw profilesError;
  }

  const profileByUserId = new Map(
    ((profiles ?? []) as ProfileEmailData[]).map((profile) => [profile.id, profile])
  );
  const authEmailByUserId = new Map<string, string>();
  const userIdsMissingProfileEmail = userIds.filter((userId) => !profileByUserId.get(userId)?.email);

  await Promise.all(
    userIdsMissingProfileEmail.map(async (userId) => {
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);

      if (authError) {
        throw authError;
      }

      if (authUser.user?.email) {
        authEmailByUserId.set(userId, authUser.user.email);
      }
    })
  );

  return userIds
    .map((userId) => {
      const booking = bookingsByUserId.get(userId);
      const profile = profileByUserId.get(userId);
      const email = profile?.email || authEmailByUserId.get(userId);

      if (!email) {
        return null;
      }

      return {
        idempotencyRecipientKey: userId,
        email,
        playerName: profile?.username || booking?.player_name || "Player",
      };
    })
    .filter((recipient): recipient is EmailRecipient => Boolean(recipient));
}

export async function sendGameCancelledEmails(params: GameCancelledEmailParams) {
  if (!isGameCancelledEmailEnabled()) {
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
    throw new Error("Unable to send game cancelled email: game not found.");
  }

  const recipients = await getGameCancelledRecipients(game.id);
  const gameTitle = game.title || "Your football match";
  const gameLocation = game.location || "TBD";
  const gameTime = game.time || "TBD";
  const gamePrice = formatPrice(game.price, "GBP");
  const gameUrl = getGameUrl(game.id);
  const subject = `Game cancelled: ${gameTitle}`;
  let sentCount = 0;

  for (const recipient of recipients) {
    const text = [
      `Hi ${recipient.playerName},`,
      "",
      "Unfortunately, this game has been cancelled.",
      "",
      "Your payment has been automatically added to your Fair Play Football wallet and is ready to use for your next booking.",
      "",
      "If you'd prefer a refund, you can request one from your wallet at any time.",
      "",
      "We apologise for the inconvenience and hope to see you at another Fair Play Football game soon.",
      "",
      `Game: ${gameTitle}`,
      `Location: ${gameLocation}`,
      `Kick-off: ${gameTime}`,
      `Price: ${gamePrice}`,
      "",
      `View game: ${gameUrl}`,
    ].join("\n");

    const html = renderEmailLayout({
      previewText: `This game has been cancelled: ${gameTitle}.`,
      title: "Game cancelled",
      ctaHref: gameUrl,
      ctaLabel: "View game",
      bodyHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(recipient.playerName)},
        </p>
        <p style="margin:0 0 18px;color:#d4d4d8;">
          Unfortunately, this game has been cancelled.
        </p>
        <p style="margin:0 0 22px;color:#d4d4d8;">
          Your payment has been automatically added to your Fair Play Football wallet and is ready to use for your next booking.
        </p>
        <p style="margin:0 0 22px;color:#d4d4d8;">
          If you'd prefer a refund, you can request one from your wallet at any time.
        </p>
        <p style="margin:0 0 22px;color:#d4d4d8;">
          We apologise for the inconvenience and hope to see you at another Fair Play Football game soon.
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
      idempotencyKey: `game_cancelled:game:${game.id}:recipient:${recipient.idempotencyRecipientKey}`,
    });

    sentCount += 1;
  }

  return { skipped: false, sentCount };
}
