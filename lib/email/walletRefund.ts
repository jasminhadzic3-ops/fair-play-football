import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import { escapeHtml, formatPrice, getSiteUrl, renderEmailLayout } from "./shared";

export type WalletRefundEmailOutcome =
  | "requested"
  | "processing"
  | "completed"
  | "failed_credit_available"
  | "manual_review";

type SendWalletRefundEmailParams = {
  refundRequestId: number;
  userId: string;
  outcome: WalletRefundEmailOutcome;
  amount: number | string | null;
  currency: string | null;
};

type ProfileEmailData = {
  email: string | null;
  username: string | null;
};

function getFirstName(playerName: string | null | undefined) {
  return playerName?.trim().split(/\s+/)[0] || "Player";
}

function getOutcomeCopy(outcome: WalletRefundEmailOutcome, formattedAmount: string) {
  switch (outcome) {
    case "requested":
      return {
        subject: "Refund Requested",
        heading: "Refund Requested",
        previewText: `We’ve received your request to refund ${formattedAmount}.`,
        paragraphs: [
          `We’ve received your request to refund ${formattedAmount} from your Fair Play Wallet to your original payment method.`,
          "You can track the status from your Wallet.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Refund Requested",
        ctaLabel: "View refund status",
      };
    case "processing":
      return {
        subject: "Refund Processing",
        heading: "Refund Processing",
        previewText: `Your ${formattedAmount} refund is being processed.`,
        paragraphs: [
          `Your ${formattedAmount} refund is being processed to your original payment method.`,
          "We’ll update your Wallet as soon as the status changes.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Refund Processing",
        ctaLabel: "View refund status",
      };
    case "completed":
      return {
        subject: "Refund Completed",
        heading: "Refund Completed",
        previewText: `Your refund of ${formattedAmount} has been completed.`,
        paragraphs: [
          `Your refund of ${formattedAmount} has been completed to your original payment method.`,
          "Your bank or card provider may take several working days to display the refund.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Refund Completed",
        ctaLabel: "View wallet",
      };
    case "failed_credit_available":
      return {
        subject: "Refund Returned to Wallet",
        heading: "Refund Returned to Wallet",
        previewText: `Your ${formattedAmount} is available again in your Fair Play Wallet.`,
        paragraphs: [
          `We couldn’t complete your refund of ${formattedAmount} to your original payment method.`,
          "The credit is available again in your Fair Play Wallet. You can use it for another game or request the refund again.",
        ],
        amountLabel: "Available wallet credit",
        statusLabel: "Refund Returned to Wallet",
        ctaLabel: "View wallet",
      };
    case "manual_review":
      return {
        subject: "Refund Under Review",
        heading: "Refund Under Review",
        previewText: `We’re checking the status of your ${formattedAmount} refund.`,
        paragraphs: [
          `We’re checking the status of your ${formattedAmount} refund.`,
          "Please don’t submit another refund request while this check is in progress. We’ll update your Wallet as soon as the status is confirmed.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Refund Under Review",
        ctaLabel: "View refund status",
      };
  }
}

export async function sendWalletRefundEmail({
  refundRequestId,
  userId,
  outcome,
  amount,
  currency,
}: SendWalletRefundEmailParams) {
  const [{ data: profile, error: profileError }, { data: authUser, error: authError }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("email,username")
      .eq("id", userId)
      .maybeSingle<ProfileEmailData>(),
    supabaseAdmin.auth.admin.getUserById(userId),
  ]);

  if (profileError) {
    throw profileError;
  }

  if (authError) {
    throw authError;
  }

  const recipientEmail = profile?.email || authUser.user?.email;

  if (!recipientEmail) {
    throw new Error("Unable to send wallet refund email: player email not found.");
  }

  const firstName = getFirstName(profile?.username);
  const formattedAmount = formatPrice(Number(amount ?? 0), currency || "GBP");
  const outcomeCopy = getOutcomeCopy(outcome, formattedAmount);
  const walletUrl = `${getSiteUrl()}/wallet`;
  const idempotencyKey = `wallet_refund:${outcome}:request:${refundRequestId}`;

  const text = [
    `Hi ${firstName},`,
    "",
    ...outcomeCopy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${outcomeCopy.amountLabel}: ${formattedAmount}`,
    outcomeCopy.statusLabel ? `Refund status: ${outcomeCopy.statusLabel}` : null,
    "",
    `${outcomeCopy.ctaLabel}: ${walletUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderEmailLayout({
    previewText: outcomeCopy.previewText,
    title: outcomeCopy.heading,
    ctaHref: walletUrl,
    ctaLabel: outcomeCopy.ctaLabel,
    footerText: "Fair Play Football will keep your Wallet updated.",
    bodyHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(firstName)},
      </p>
      ${outcomeCopy.paragraphs
        .map(
          (paragraph) => `<p style="margin:0 0 18px;color:#d4d4d8;">
            ${escapeHtml(paragraph)}
          </p>`
        )
        .join("")}
      <div style="border:1px solid #27272a;background:#111113;border-radius:22px;padding:18px;margin:0 0 22px;">
        <p style="margin:0 0 14px;font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
          Refund details
        </p>
        <p style="margin:0 0 10px;color:#f4f4f5;"><strong>${escapeHtml(outcomeCopy.amountLabel)}:</strong> ${escapeHtml(formattedAmount)}</p>
        ${
          outcomeCopy.statusLabel
            ? `<p style="margin:0;color:#f4f4f5;"><strong>Refund status:</strong> ${escapeHtml(outcomeCopy.statusLabel)}</p>`
            : ""
        }
      </div>
    `,
  });

  return sendResendEmail({
    to: recipientEmail,
    subject: outcomeCopy.subject,
    html,
    text,
    idempotencyKey,
  });
}
