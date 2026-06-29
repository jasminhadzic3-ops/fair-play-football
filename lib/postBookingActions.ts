import "server-only";

import { sendBookingConfirmedEmail } from "@/lib/email/bookingConfirmed";
import { sendGameHalfFullEmails } from "@/lib/email/gameHalfFull";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RunPostBookingActionsParams = {
  bookingId: number;
  userId: string;
  gameId: number;
  playerName: string;
  bookingConfirmation?: {
    paymentId: number;
    amount?: number | null;
    currency?: string | null;
    checkoutId?: string | null;
    checkoutReference?: string | null;
  };
};

export async function removeWaitingListEntryForBookedUser(userId: string, gameId: number) {
  const { error } = await supabaseAdmin
    .from("waiting_list")
    .update({ status: "removed" })
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("status", "waiting");

  if (error) {
    throw error;
  }
}

export async function runPostBookingActions({
  bookingId,
  userId,
  gameId,
  playerName,
  bookingConfirmation,
}: RunPostBookingActionsParams) {
  await removeWaitingListEntryForBookedUser(userId, gameId);

  if (bookingConfirmation) {
    try {
      await sendBookingConfirmedEmail({
        bookingId,
        paymentId: bookingConfirmation.paymentId,
        userId,
        gameId,
        playerName,
        amount: bookingConfirmation.amount,
        currency: bookingConfirmation.currency,
        checkoutId: bookingConfirmation.checkoutId,
        checkoutReference: bookingConfirmation.checkoutReference,
      });
    } catch (emailError) {
      console.error("Unable to send booking confirmation email:", {
        bookingId,
        paymentId: bookingConfirmation.paymentId,
        error: emailError,
      });
    }
  }

  try {
    await sendGameHalfFullEmails({
      gameId,
    });
  } catch (emailError) {
    console.error("Unable to send game half full email:", {
      gameId,
      bookingId,
      error: emailError,
    });
  }
}
