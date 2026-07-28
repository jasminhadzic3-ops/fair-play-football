import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    rpc: supabaseRpcMock,
  },
}));

import { sendEmailWithDeliveryTracking } from "@/lib/email/deliveryTracking";

function claimResponse(overrides: Record<string, unknown> = {}) {
  return {
    delivery_id: 10,
    should_send: true,
    status: "sending",
    attempts: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseRpcMock.mockImplementation((functionName: string) => {
    if (functionName === "claim_email_delivery") {
      return {
        single: vi.fn().mockResolvedValue({
          data: claimResponse(),
          error: null,
        }),
      };
    }

    return Promise.resolve({ error: null });
  });
});

describe("sendEmailWithDeliveryTracking", () => {
  it("claims, sends, and marks a delivery as sent", async () => {
    const send = vi.fn().mockResolvedValue({ id: "email-1" });

    const result = await sendEmailWithDeliveryTracking({
      deliveryKey: "booking_confirmed:booking:123",
      emailType: "booking_confirmation",
      recipientKey: "user-1",
      bookingId: 123,
      gameId: 10,
      metadata: { payment_id: 456 },
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ skipped: false, deliveryId: 10, status: "sent" });
    expect(supabaseRpcMock).toHaveBeenNthCalledWith(1, "claim_email_delivery", {
      p_delivery_key: "booking_confirmed:booking:123",
      p_email_type: "booking_confirmation",
      p_recipient_key: "user-1",
      p_booking_id: 123,
      p_game_id: 10,
      p_metadata: { payment_id: 456 },
    });
    expect(supabaseRpcMock).toHaveBeenNthCalledWith(2, "mark_email_delivery_sent", {
      p_delivery_id: 10,
      p_provider_message_id: "email-1",
    });
  });

  it("does not call the sender when the durable delivery is already sent", async () => {
    supabaseRpcMock.mockImplementationOnce(() => ({
      single: vi.fn().mockResolvedValue({
        data: claimResponse({ should_send: false, status: "sent" }),
        error: null,
      }),
    }));

    const send = vi.fn();

    const result = await sendEmailWithDeliveryTracking({
      deliveryKey: "booking_confirmed:booking:123",
      emailType: "booking_confirmation",
      recipientKey: "user-1",
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: true, deliveryId: 10, status: "sent" });
  });

  it("marks failed sends as retryable and rethrows the send error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend temporarily unavailable"));

    await expect(
      sendEmailWithDeliveryTracking({
        deliveryKey: "booking_confirmed:booking:123",
        emailType: "booking_confirmation",
        recipientKey: "user-1",
        send,
      })
    ).rejects.toThrow("resend temporarily unavailable");

    expect(supabaseRpcMock).toHaveBeenLastCalledWith("mark_email_delivery_failed", {
      p_delivery_id: 10,
      p_sanitized_error_message: "resend temporarily unavailable",
    });
  });

  it("keeps EMAIL_DRY_RUN deliveries retryable instead of marking them sent", async () => {
    const send = vi.fn().mockResolvedValue({ dryRun: true });

    const result = await sendEmailWithDeliveryTracking({
      deliveryKey: "booking_confirmed:booking:123",
      emailType: "booking_confirmation",
      recipientKey: "user-1",
      send,
    });

    expect(result).toMatchObject({ skipped: false, deliveryId: 10, status: "dry_run" });
    expect(supabaseRpcMock).toHaveBeenLastCalledWith("mark_email_delivery_failed", {
      p_delivery_id: 10,
      p_sanitized_error_message: "email_dry_run",
    });
  });

  it("retries after a failed delivery is claimed again", async () => {
    const send = vi.fn().mockResolvedValue({ id: "email-2" });

    supabaseRpcMock.mockImplementationOnce(() => ({
      single: vi.fn().mockResolvedValue({
        data: claimResponse({ attempts: 2 }),
        error: null,
      }),
    }));

    await sendEmailWithDeliveryTracking({
      deliveryKey: "booking_confirmed:booking:123",
      emailType: "booking_confirmation",
      recipientKey: "user-1",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).toHaveBeenLastCalledWith("mark_email_delivery_sent", {
      p_delivery_id: 10,
      p_provider_message_id: "email-2",
    });
  });

  it("lets only the claimed concurrent trigger send", async () => {
    supabaseRpcMock
      .mockImplementationOnce(() => ({
        single: vi.fn().mockResolvedValue({
          data: claimResponse({ delivery_id: 10, should_send: true }),
          error: null,
        }),
      }))
      .mockImplementationOnce(() => ({
        single: vi.fn().mockResolvedValue({
          data: claimResponse({ delivery_id: 10, should_send: false, status: "sending" }),
          error: null,
        }),
      }))
      .mockImplementationOnce(() => Promise.resolve({ error: null }));

    const send = vi.fn().mockResolvedValue({ id: "email-1" });

    const [first, second] = await Promise.all([
      sendEmailWithDeliveryTracking({
        deliveryKey: "game_half_full:game:10:recipient:user-1",
        emailType: "game_half_full",
        recipientKey: "user-1",
        gameId: 10,
        send,
      }),
      sendEmailWithDeliveryTracking({
        deliveryKey: "game_half_full:game:10:recipient:user-1",
        emailType: "game_half_full",
        recipientKey: "user-1",
        gameId: 10,
        send,
      }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
  });
});
