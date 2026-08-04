import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: supabaseFromMock,
    auth: {
      admin: {
        getUserById: getUserByIdMock,
      },
    },
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

import { sendWalletRefundEmail, type WalletRefundEmailOutcome } from "@/lib/email/walletRefund";

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

const state: {
  profile: ProfileRow;
} = {
  profile: {
    id: "user-1",
    email: "profile@example.com",
    username: "Jasmin Hadzic",
  },
};

class MockSupabaseQuery {
  select() {
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle<T>() {
    return { data: state.profile as T, error: null };
  }
}

async function sendForOutcome(outcome: WalletRefundEmailOutcome, amount: number | string | null = 8) {
  await sendWalletRefundEmail({
    refundRequestId: 501,
    userId: "user-1",
    outcome,
    amount,
    currency: "GBP",
  });

  return sendResendEmailMock.mock.calls.at(-1)?.[0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.fairplayfootball.co.uk";
  supabaseFromMock.mockImplementation(() => new MockSupabaseQuery());
  getUserByIdMock.mockResolvedValue({
    data: { user: { email: "auth@example.com" } },
    error: null,
  });
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
  state.profile = {
    id: "user-1",
    email: "profile@example.com",
    username: "Jasmin Hadzic",
  };
});

describe("sendWalletRefundEmail", () => {
  it.each([
    [
      "requested",
      "Refund Requested",
      "Refund Requested",
      "We’ve received your request to refund £8.00 from your Fair Play Wallet to your original payment method.",
      "Refund status: Refund Requested",
      "View refund status",
    ],
    [
      "processing",
      "Refund Processing",
      "Refund Processing",
      "Your £8.00 refund is being processed to your original payment method.",
      "Refund status: Refund Processing",
      "View refund status",
    ],
    [
      "completed",
      "Refund Completed",
      "Refund Completed",
      "Your refund of £8.00 has been completed to your original payment method.",
      "Refund status: Refund Completed",
      "View wallet",
    ],
    [
      "failed_credit_available",
      "Refund Returned to Wallet",
      "Refund Returned to Wallet",
      "The credit is available again in your Fair Play Wallet.",
      "Refund status: Refund Returned to Wallet",
      "View wallet",
    ],
    [
      "manual_review",
      "Refund Under Review",
      "Refund Under Review",
      "Please don’t submit another refund request while this check is in progress.",
      "Refund status: Refund Under Review",
      "View refund status",
    ],
  ] satisfies Array<[WalletRefundEmailOutcome, string, string, string, string, string]>)(
    "renders the %s outcome",
    async (outcome, subject, heading, bodyCopy, detailCopy, buttonLabel) => {
      const email = await sendForOutcome(outcome);

      expect(email.to).toBe("profile@example.com");
      expect(email.subject).toBe(subject);
      expect(email.text).toContain("Hi Jasmin,");
      expect(email.text).toContain(bodyCopy);
      expect(email.text).toContain(detailCopy);
      expect(email.text).toContain(`${buttonLabel}: https://www.fairplayfootball.co.uk/wallet`);
      expect(email.html).toContain(heading);
      expect(email.html).toContain(bodyCopy);
      expect(email.html).toContain(buttonLabel);
      expect(email.idempotencyKey).toBe(`wallet_refund:${outcome}:request:501`);
    }
  );

  it("does not tell players to reply or contact the organiser for normal refund outcomes", async () => {
    const outcomes: WalletRefundEmailOutcome[] = [
      "requested",
      "processing",
      "completed",
      "failed_credit_available",
    ];

    for (const outcome of outcomes) {
      const email = await sendForOutcome(outcome);
      const combined = `${email.subject}\n${email.text}\n${email.html}`;

      expect(combined).not.toMatch(/reply to this email/i);
      expect(combined).not.toMatch(/contact the organiser/i);
      expect(combined).not.toMatch(/technical payment-provider/i);
    }
  });

  it("falls back to Supabase Auth email and Player greeting", async () => {
    state.profile = {
      id: "user-1",
      email: null,
      username: null,
    };

    const email = await sendForOutcome("requested", "8.5");

    expect(email.to).toBe("auth@example.com");
    expect(email.text).toContain("Hi Player,");
    expect(email.text).toContain("£8.50");
  });
});
