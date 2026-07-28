import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

type EmailDeliveryType = "booking_confirmation" | "game_half_full";

type EmailDeliveryClaim = {
  delivery_id: number;
  should_send: boolean;
  status: string;
  attempts: number;
};

type TrackedEmailResult = {
  id?: string;
  dryRun?: boolean;
};

type SendEmailWithDeliveryTrackingParams<T extends TrackedEmailResult> = {
  deliveryKey: string;
  emailType: EmailDeliveryType;
  recipientKey: string;
  bookingId?: number | null;
  gameId?: number | null;
  metadata?: Record<string, unknown>;
  send: () => Promise<T>;
};

function sanitizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "email_send_failed";
  }

  return error.message.replace(/\s+/g, " ").trim().slice(0, 240) || "email_send_failed";
}

export async function sendEmailWithDeliveryTracking<T extends TrackedEmailResult>({
  deliveryKey,
  emailType,
  recipientKey,
  bookingId = null,
  gameId = null,
  metadata = {},
  send,
}: SendEmailWithDeliveryTrackingParams<T>) {
  const { data: claim, error: claimError } = await supabaseAdmin
    .rpc("claim_email_delivery", {
      p_delivery_key: deliveryKey,
      p_email_type: emailType,
      p_recipient_key: recipientKey,
      p_booking_id: bookingId,
      p_game_id: gameId,
      p_metadata: metadata,
    })
    .single<EmailDeliveryClaim>();

  if (claimError) {
    throw claimError;
  }

  if (!claim?.should_send) {
    return {
      skipped: true,
      deliveryId: claim?.delivery_id ?? null,
      status: claim?.status ?? "unknown",
    };
  }

  try {
    const result = await send();

    if (result.dryRun) {
      await supabaseAdmin.rpc("mark_email_delivery_failed", {
        p_delivery_id: claim.delivery_id,
        p_sanitized_error_message: "email_dry_run",
      });

      return {
        skipped: false,
        deliveryId: claim.delivery_id,
        status: "dry_run",
        result,
      };
    }

    const { error: sentError } = await supabaseAdmin.rpc("mark_email_delivery_sent", {
      p_delivery_id: claim.delivery_id,
      p_provider_message_id: result.id ?? null,
    });

    if (sentError) {
      throw sentError;
    }

    return {
      skipped: false,
      deliveryId: claim.delivery_id,
      status: "sent",
      result,
    };
  } catch (error) {
    await supabaseAdmin.rpc("mark_email_delivery_failed", {
      p_delivery_id: claim.delivery_id,
      p_sanitized_error_message: sanitizeErrorMessage(error),
    });

    throw error;
  }
}
