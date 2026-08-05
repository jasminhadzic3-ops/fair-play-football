import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatPrice,
  getSiteUrl,
  renderEmailParagraphs,
  renderPremiumEmailLayout,
  renderPremiumInfoCard,
} from "./shared";

export type WalletRefundEmailOutcome =
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
        ctaLabel: "View Wallet",
      };
    case "completed":
      return {
        subject: "Your Refund Has Been Processed",
        heading: "Your Refund Has Been Processed",
        previewText: "Your refund has been processed successfully.",
        paragraphs: [
          "Your refund has been processed successfully.",
          "Depending on your bank, it may take a few working days to appear in your account.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Returned to your original payment method",
        ctaLabel: "View Wallet",
        completedRefund: true,
      };
    case "failed_credit_available":
      return {
        subject: "Credit Added To Your Wallet",
        heading: "Credit Added To Your Wallet",
        previewText: `${formattedAmount} has been added to your Fair Play Wallet.`,
        paragraphs: [
          `${formattedAmount} has been added to your Fair Play Wallet.`,
        ],
        amountLabel: "Amount",
        statusLabel: "Refund credited to your wallet",
        ctaLabel: "View Wallet",
        reason: "Refund credited to your wallet",
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
        ctaLabel: "View Wallet",
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
    "reason" in outcomeCopy && outcomeCopy.reason ? "Reason" : `${outcomeCopy.amountLabel}: ${formattedAmount}`,
    "reason" in outcomeCopy && outcomeCopy.reason
      ? outcomeCopy.reason
      : "completedRefund" in outcomeCopy && outcomeCopy.completedRefund
        ? outcomeCopy.statusLabel
      : outcomeCopy.statusLabel
        ? `Refund status: ${outcomeCopy.statusLabel}`
        : null,
    "",
    `${outcomeCopy.ctaLabel}: ${walletUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderPremiumEmailLayout({
    previewText: outcomeCopy.previewText,
    title: outcomeCopy.heading,
    ctaHref: walletUrl,
    ctaLabel: outcomeCopy.ctaLabel,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(firstName)},
      </p>
      ${renderEmailParagraphs(outcomeCopy.paragraphs)}
    `,
    cardHtml: "reason" in outcomeCopy && outcomeCopy.reason
      ? renderPremiumInfoCard("Reason", [{ value: outcomeCopy.reason }])
      : "completedRefund" in outcomeCopy && outcomeCopy.completedRefund
        ? renderPremiumInfoCard("Refund Details", [
            { icon: "💷", value: formattedAmount },
            { value: outcomeCopy.statusLabel },
          ])
      : renderPremiumInfoCard("Refund Details", [
          { label: `${outcomeCopy.amountLabel}:`, value: formattedAmount },
          { label: "Status:", value: outcomeCopy.statusLabel },
        ]),
  });

  return sendResendEmail({
    to: recipientEmail,
    subject: outcomeCopy.subject,
    html,
    text,
    idempotencyKey,
  });
}
