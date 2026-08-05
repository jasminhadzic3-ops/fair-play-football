import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  getSiteUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumGameDetailsCard,
} from "./shared";

type GameCancelledEmailParams = {
  gameId: number;
};

type GameEmailData = {
  id: number;
  title: string | null;
  location: string | null;
  time: string | null;
  starts_at: string | null;
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

function getFirstName(playerName: string | null | undefined) {
  return playerName?.trim().split(/\s+/)[0] || "Player";
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
    .select("id,title,location,time,starts_at,price")
    .eq("id", params.gameId)
    .maybeSingle<GameEmailData>();

  if (gameError) {
    throw gameError;
  }

  if (!game) {
    throw new Error("Unable to send game cancelled email: game not found.");
  }

  const recipients = await getGameCancelledRecipients(game.id);
  const gameLocation = game.location || "TBD";
  const kickoff = formatEmailGameDateTime(game.starts_at, game.time);
  const walletUrl = `${getSiteUrl()}/wallet`;
  const subject = "Your Game Has Been Cancelled";
  let sentCount = 0;

  for (const recipient of recipients) {
    const firstName = getFirstName(recipient.playerName);
    const text = [
      `Hi ${firstName},`,
      "",
      "Unfortunately this game has been cancelled.",
      "",
      "Your payment has already been returned to your Fair Play Wallet as credit.",
      "",
      "If you'd prefer a refund to your original payment method, you can request one from your Wallet.",
      "",
      "Game Details",
      `📅 ${kickoff.date}`,
      `🕒 ${kickoff.time}`,
      `📍 ${gameLocation}`,
      "",
      `Open My Wallet: ${walletUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    const html = renderPremiumEmailLayout({
      previewText: "Unfortunately this game has been cancelled.",
      title: "Your Game Has Been Cancelled",
      ctaHref: walletUrl,
      ctaLabel: "Open My Wallet",
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(firstName)},
        </p>
        ${renderEmailParagraphs([
          "Unfortunately this game has been cancelled.",
          "Your payment has already been returned to your Fair Play Wallet as credit.",
          "If you'd prefer a refund to your original payment method, you can request one from your Wallet.",
        ])}
      `,
      cardHtml: renderPremiumGameDetailsCard({
        date: kickoff.date,
        time: kickoff.time,
        venue: gameLocation,
      }),
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
