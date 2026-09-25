import "server-only";

import { createGameCancelledNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatEmailGameDateTime,
  getFirstName as resolveFirstName,
  getSiteUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumInfoCard,
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
  userId?: string;
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
  return resolveFirstName(playerName);
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
        userId,
        idempotencyRecipientKey: userId,
        email,
        playerName: profile?.username || booking?.player_name || "Player",
      };
    })
    .filter((recipient): recipient is EmailRecipient & { userId: string } => Boolean(recipient));
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
  const subject = "Game Cancelled";
  const gameName = game.title || "";
  let sentCount = 0;

  for (const recipient of recipients) {
    const firstName = getFirstName(recipient.playerName);
    const text = [
      `Hi ${firstName},`,
      "",
      `Unfortunately, ${gameName} has been cancelled.`,
      "",
      "Your booking has been cancelled automatically, and any eligible credit has been added to your Fair Play Wallet.",
      "",
      "If you'd prefer a refund to your original payment method, you can request one at any time from your wallet.",
      "",
      "Cancelled Game",
      `Game\n${gameName}`,
      `Date\n${kickoff.date}`,
      `Kick-off\n${kickoff.time}`,
      `Venue\n${gameLocation}`,
      "",
      `Open Wallet: ${walletUrl}`,
      "",
      "We apologise for any inconvenience and hope to see you at another Fair Play Football game soon.",
      "",
      "If you have any questions, we're always happy to help.",
      "",
      "booking@fairplayfootball.co.uk",
      "© Fair Play Football",
    ]
      .filter(Boolean)
      .join("\n");

    const html = renderPremiumEmailLayout({
      previewText: `Unfortunately, ${gameName} has been cancelled.`,
      title: "We're Sorry",
      ctaHref: walletUrl,
      ctaLabel: "Open Wallet",
      footerText: "We apologise for any inconvenience and hope to see you at another Fair Play Football game soon. If you have any questions, we're always happy to help.",
      introHtml: `
        <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
          Hi ${escapeHtml(firstName)},
        </p>
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          Unfortunately, <strong>${escapeHtml(gameName)}</strong> has been cancelled.
        </p>
        ${renderEmailParagraphs([
          "Your booking has been cancelled automatically, and any eligible credit has been added to your Fair Play Wallet.",
          "If you'd prefer a refund to your original payment method, you can request one at any time from your wallet.",
        ])}
      `,
      cardHtml: renderPremiumInfoCard("Cancelled Game", [
        { label: "Game", value: gameName },
        { label: "Date", value: kickoff.date },
        { label: "Kick-off", value: kickoff.time },
        { label: "Venue", value: gameLocation },
      ]),
    });

    await sendResendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      idempotencyKey: `game_cancelled:game:${game.id}:recipient:${recipient.idempotencyRecipientKey}`,
    });

    if (recipient.userId) {
      await createGameCancelledNotification({
        userId: recipient.userId,
        game,
      }).catch((notificationError) => {
        console.error("Unable to create game cancelled notification:", {
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
