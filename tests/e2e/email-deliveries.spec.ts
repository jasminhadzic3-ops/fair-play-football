import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createE2ESupabaseClient } from "./helpers/moneySeed";
import {
  canRunDatabaseMutationE2E,
  requireDatabaseMutationE2EEnv,
} from "./helpers/supabaseEnv";

type DeliveryClaim = {
  delivery_id: number;
  should_send: boolean;
  status: string;
  attempts: number;
};

type DeliveryRow = {
  id: number;
  delivery_key: string;
  email_type: string;
  recipient_key: string;
  booking_id: number | null;
  game_id: number | null;
  status: string;
  attempts: number;
  claimed_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  sanitized_error_message: string | null;
  metadata: Record<string, unknown>;
};

function uniqueRunId() {
  return `e2e_email_delivery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function claimDelivery(
  supabase: SupabaseClient,
  params: {
    deliveryKey: string;
    emailType: "booking_confirmation" | "game_half_full";
    recipientKey: string;
    bookingId?: number | null;
    gameId?: number | null;
    runId: string;
  }
) {
  const { data, error } = await supabase
    .rpc("claim_email_delivery", {
      p_delivery_key: params.deliveryKey,
      p_email_type: params.emailType,
      p_recipient_key: params.recipientKey,
      p_booking_id: params.bookingId ?? null,
      p_game_id: params.gameId ?? null,
      p_metadata: {
        e2e_run_id: params.runId,
        source: "email_delivery_e2e",
      },
    })
    .single<DeliveryClaim>();

  if (error || !data) {
    throw new Error(`claim ${params.deliveryKey}: ${error?.message || "no row returned"}`);
  }

  return data;
}

async function markSent(supabase: SupabaseClient, deliveryId: number, providerMessageId = "dry-run-provider-id") {
  const { error } = await supabase.rpc("mark_email_delivery_sent", {
    p_delivery_id: deliveryId,
    p_provider_message_id: providerMessageId,
  });

  if (error) {
    throw new Error(`mark sent ${deliveryId}: ${error.message}`);
  }
}

async function markFailed(supabase: SupabaseClient, deliveryId: number, message = "email_dry_run") {
  const { error } = await supabase.rpc("mark_email_delivery_failed", {
    p_delivery_id: deliveryId,
    p_sanitized_error_message: message,
  });

  if (error) {
    throw new Error(`mark failed ${deliveryId}: ${error.message}`);
  }
}

async function loadDeliveryRows(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from("email_deliveries")
    .select(
      "id,delivery_key,email_type,recipient_key,booking_id,game_id,status,attempts,claimed_at,sent_at,provider_message_id,sanitized_error_message,metadata"
    )
    .filter("metadata->>e2e_run_id", "eq", runId)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`load delivery rows ${runId}: ${error.message}`);
  }

  return (data ?? []) as DeliveryRow[];
}

async function cleanupEmailDeliveries(supabase: SupabaseClient, runId: string) {
  const { error } = await supabase
    .from("email_deliveries")
    .delete()
    .filter("metadata->>e2e_run_id", "eq", runId);

  if (error) {
    throw new Error(`cleanup email deliveries ${runId}: ${error.message}`);
  }
}

test.describe("TEST-only durable email delivery tracking", () => {
  test.skip(
    !canRunDatabaseMutationE2E(),
    "TEST-only email delivery E2E requires E2E_ALLOW_DB_MUTATION=true and the TEST Supabase project."
  );

  test("booking confirmation delivery claims are durable, retryable, and sanitized", async () => {
    const env = requireDatabaseMutationE2EEnv();
    const supabase = createE2ESupabaseClient(env);
    const runId = uniqueRunId();

    try {
      const bookingKey = `booking_confirmed:booking:${runId}`;
      const firstClaim = await claimDelivery(supabase, {
        deliveryKey: bookingKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-booking",
        bookingId: 1001,
        gameId: 2001,
        runId,
      });

      expect(firstClaim).toMatchObject({
        should_send: true,
        status: "sending",
        attempts: 1,
      });

      await markSent(supabase, firstClaim.delivery_id, "booking-confirmation-dry-run");

      const duplicateWebhookClaim = await claimDelivery(supabase, {
        deliveryKey: bookingKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-booking",
        bookingId: 1001,
        gameId: 2001,
        runId,
      });

      expect(duplicateWebhookClaim).toMatchObject({
        delivery_id: firstClaim.delivery_id,
        should_send: false,
        status: "sent",
        attempts: 1,
      });

      const duplicateWalletClaim = await claimDelivery(supabase, {
        deliveryKey: bookingKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-booking",
        bookingId: 1001,
        gameId: 2001,
        runId,
      });

      expect(duplicateWalletClaim.should_send).toBe(false);
      expect(duplicateWalletClaim.status).toBe("sent");

      const failedKey = `booking_confirmed:booking:${runId}:failed`;
      const failedClaim = await claimDelivery(supabase, {
        deliveryKey: failedKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-failed",
        bookingId: 1002,
        gameId: 2002,
        runId,
      });
      await markFailed(supabase, failedClaim.delivery_id, "mock_send_failed");

      const retryClaim = await claimDelivery(supabase, {
        deliveryKey: failedKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-failed",
        bookingId: 1002,
        gameId: 2002,
        runId,
      });

      expect(retryClaim).toMatchObject({
        delivery_id: failedClaim.delivery_id,
        should_send: true,
        status: "sending",
        attempts: 2,
      });

      const staleKey = `booking_confirmed:booking:${runId}:stale`;
      const staleClaim = await claimDelivery(supabase, {
        deliveryKey: staleKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-stale",
        bookingId: 1003,
        gameId: 2003,
        runId,
      });

      const { error: staleUpdateError } = await supabase
        .from("email_deliveries")
        .update({ claimed_at: "2000-01-01T00:00:00.000Z" })
        .eq("id", staleClaim.delivery_id);

      if (staleUpdateError) {
        throw new Error(`make stale delivery: ${staleUpdateError.message}`);
      }

      const staleRetryClaim = await claimDelivery(supabase, {
        deliveryKey: staleKey,
        emailType: "booking_confirmation",
        recipientKey: "user-e2e-stale",
        bookingId: 1003,
        gameId: 2003,
        runId,
      });

      expect(staleRetryClaim).toMatchObject({
        delivery_id: staleClaim.delivery_id,
        should_send: true,
        status: "sending",
        attempts: 2,
      });

      const rows = await loadDeliveryRows(supabase, runId);
      expect(rows).toHaveLength(3);
      expect(rows.some((row) => JSON.stringify(row).includes("@"))).toBe(false);
      expect(rows.some((row) => JSON.stringify(row).includes("Player"))).toBe(false);
      expect(rows.every((row) => row.metadata.e2e_run_id === runId)).toBe(true);
      expect(rows.find((row) => row.delivery_key === bookingKey)).toMatchObject({
        status: "sent",
        attempts: 1,
        provider_message_id: "booking-confirmation-dry-run",
      });
      expect(rows.find((row) => row.delivery_key === bookingKey)?.sent_at).not.toBeNull();
      expect(rows.filter((row) => row.status !== "sent").every((row) => row.sent_at === null)).toBe(true);
      expect(rows.find((row) => row.delivery_key === failedKey)).toMatchObject({
        status: "sending",
        attempts: 2,
        sanitized_error_message: null,
      });
    } finally {
      await cleanupEmailDeliveries(supabase, runId);
      expect(await loadDeliveryRows(supabase, runId)).toEqual([]);
    }
  });

  test("half-full delivery claims are one per game/recipient and dry-run remains retryable", async () => {
    const env = requireDatabaseMutationE2EEnv();
    const supabase = createE2ESupabaseClient(env);
    const runId = uniqueRunId();

    try {
      const halfFullKey = `game_half_full:game:${runId}:recipient:user-e2e-half-full`;
      const [firstConcurrentClaim, secondConcurrentClaim] = await Promise.all([
        claimDelivery(supabase, {
          deliveryKey: halfFullKey,
          emailType: "game_half_full",
          recipientKey: "user-e2e-half-full",
          gameId: 3001,
          runId,
        }),
        claimDelivery(supabase, {
          deliveryKey: halfFullKey,
          emailType: "game_half_full",
          recipientKey: "user-e2e-half-full",
          gameId: 3001,
          runId,
        }),
      ]);

      const concurrentClaims = [firstConcurrentClaim, secondConcurrentClaim];
      expect(concurrentClaims.filter((claim) => claim.should_send)).toHaveLength(1);
      expect(concurrentClaims.filter((claim) => !claim.should_send)).toHaveLength(1);
      expect(new Set(concurrentClaims.map((claim) => claim.delivery_id)).size).toBe(1);

      const claimedDeliveryId = concurrentClaims[0].delivery_id;
      await markFailed(supabase, claimedDeliveryId, "email_dry_run");

      const dryRunRetryClaim = await claimDelivery(supabase, {
        deliveryKey: halfFullKey,
        emailType: "game_half_full",
        recipientKey: "user-e2e-half-full",
        gameId: 3001,
        runId,
      });

      expect(dryRunRetryClaim).toMatchObject({
        delivery_id: claimedDeliveryId,
        should_send: true,
        status: "sending",
        attempts: 2,
      });

      await markSent(supabase, claimedDeliveryId, "half-full-dry-run");

      const duplicateTriggerClaim = await claimDelivery(supabase, {
        deliveryKey: halfFullKey,
        emailType: "game_half_full",
        recipientKey: "user-e2e-half-full",
        gameId: 3001,
        runId,
      });

      expect(duplicateTriggerClaim).toMatchObject({
        delivery_id: claimedDeliveryId,
        should_send: false,
        status: "sent",
        attempts: 2,
      });

      const secondRecipientKey = `game_half_full:game:${runId}:recipient:user-e2e-second`;
      const secondRecipientClaim = await claimDelivery(supabase, {
        deliveryKey: secondRecipientKey,
        emailType: "game_half_full",
        recipientKey: "user-e2e-second",
        gameId: 3001,
        runId,
      });

      expect(secondRecipientClaim.should_send).toBe(true);

      const rows = await loadDeliveryRows(supabase, runId);
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => JSON.stringify(row).includes("@"))).toBe(false);
      expect(rows.some((row) => JSON.stringify(row).includes("Player"))).toBe(false);
      expect(rows.find((row) => row.delivery_key === halfFullKey)).toMatchObject({
        status: "sent",
        attempts: 2,
        provider_message_id: "half-full-dry-run",
      });
      expect(rows.find((row) => row.delivery_key === halfFullKey)?.sent_at).not.toBeNull();
      expect(rows.find((row) => row.delivery_key === secondRecipientKey)).toMatchObject({
        status: "sending",
        attempts: 1,
        sent_at: null,
      });
    } finally {
      await cleanupEmailDeliveries(supabase, runId);
      expect(await loadDeliveryRows(supabase, runId)).toEqual([]);
    }
  });
});
