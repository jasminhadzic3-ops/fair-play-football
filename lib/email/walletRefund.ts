import "server-only";

import {
  createRefundProcessedNotification,
  createWalletCreditNotification,
} from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendResendEmail } from "./resend";
import {
  escapeHtml,
  formatPrice,
  getFirstName as resolveFirstName,
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

type RefundRequestEmailData = {
  admin_note: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

const refundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function getRefundMetadataValue(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function formatPaymentMethod(value: string) {
  return value.toLowerCase() === "sumup" ? "SumUp" : value || "Original payment method";
}

function formatRefundDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : refundDateFormatter.format(date);
}

function formatRefundReason(metadata: Record<string, unknown> | null) {
  switch (getRefundMetadataValue(metadata, "source_transaction_type")) {
    case "game_cancelled_credit":
      return "Game cancelled";
    case "player_cancelled_credit":
      return "Player cancellation";
    default:
      return "Refund requested";
  }
}

function getFirstName(playerName: string | null | undefined) {
  return resolveFirstName(playerName);
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
        subject: "Refund Completed",
        heading: "Refund Completed",
        previewText: "Your refund has been processed successfully.",
        paragraphs: [
          "Your refund has now been processed successfully.",
          "Depending on your bank or payment provider, it may take a few working days for the funds to appear in your account.",
        ],
        amountLabel: "Refund amount",
        statusLabel: "Returned to your original payment method",
        ctaLabel: "View Wallet",
        completedRefund: true,
      };
    case "failed_credit_available":
      return {
        subject: "Refund Sent to Your Wallet",
        heading: "We've Added Credit to Your Wallet",
        previewText: `We were unable to process your ${formattedAmount} refund back to your original payment method.`,
        paragraphs: [
          "We were unable to process your refund back to your original payment method.",
          `Instead, ${formattedAmount} has been added to your Fair Play Wallet, where it's available to use immediately for future bookings.`,
          "If you'd still prefer a refund to your original payment method, you can submit another refund request from your wallet at any time. If you need any assistance, please contact us and we'll be happy to help.",
        ],
        amountLabel: "Amount",
        statusLabel: "Credit Available",
        ctaLabel: "Open Wallet",
        failedCreditAvailable: true,
      };
    case "manual_review":
      return {
        subject: "Refund Under Review",
        heading: "We're Looking Into It",
        previewText: `Your refund request for ${formattedAmount} requires a manual review.`,
        paragraphs: [
          `Your refund request for ${formattedAmount} has been received but requires a manual review before it can be completed.`,
          "This can occasionally happen if we're unable to confirm the refund automatically.",
          "There's nothing you need to do. We'll review your request and email you again as soon as an update is available.",
        ],
        amountLabel: "Amount",
        statusLabel: "Under Review",
        ctaLabel: "View Wallet",
        manualReview: true,
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
  let completedRefundDetails: {
    paymentMethod: string;
    refundDate: string;
    reason: string;
  } | null = null;

  if (outcome === "completed") {
    const { data: refundRequest, error: refundRequestError } = await supabaseAdmin
      .from("wallet_transactions")
      .select("admin_note,metadata,updated_at")
      .eq("id", refundRequestId)
      .eq("transaction_type", "refund_requested")
      .maybeSingle<RefundRequestEmailData>();

    if (refundRequestError) throw refundRequestError;

    const metadata = refundRequest?.metadata ?? null;
    completedRefundDetails = {
      paymentMethod: formatPaymentMethod(getRefundMetadataValue(metadata, "original_payment_method")),
      refundDate: formatRefundDate(getRefundMetadataValue(metadata, "processed_at") || refundRequest?.updated_at || null),
      reason: formatRefundReason(metadata),
    };
  }

  const text = outcome === "completed" && completedRefundDetails ? [
    `Hi ${firstName},`,
    "",
    "Your refund has now been processed successfully.",
    "",
    "Depending on your bank or payment provider, it may take a few working days for the funds to appear in your account.",
    "",
    "Refund Details",
    `Amount\n${formattedAmount}`,
    `Original Payment Method\n${completedRefundDetails.paymentMethod}`,
    `Refund Date\n${completedRefundDetails.refundDate}`,
    `Reason\n${completedRefundDetails.reason}`,
    "",
    `View Wallet: ${walletUrl}`,
    "",
    "Thank you for being part of Fair Play Football.",
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n") : outcome === "manual_review" ? [
    `Hi ${firstName},`,
    "",
    `Your refund request for ${formattedAmount} has been received but requires a manual review before it can be completed.`,
    "",
    "This can occasionally happen if we're unable to confirm the refund automatically.",
    "",
    "There's nothing you need to do. We'll review your request and email you again as soon as an update is available.",
    "",
    "Refund Details",
    `Amount\n${formattedAmount}`,
    "Status\nUnder Review",
    "",
    `View Wallet: ${walletUrl}`,
    "",
    "Thank you for your patience.",
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n") : outcome === "failed_credit_available" ? [
    `Hi ${firstName},`,
    "",
    "We were unable to process your refund back to your original payment method.",
    "",
    `Instead, ${formattedAmount} has been added to your Fair Play Wallet, where it's available to use immediately for future bookings.`,
    "",
    "If you'd still prefer a refund to your original payment method, you can submit another refund request from your wallet at any time. If you need any assistance, please contact us and we'll be happy to help.",
    "",
    "Wallet Credit",
    `Amount\n${formattedAmount}`,
    "Status\nCredit Available",
    "",
    `Open Wallet: ${walletUrl}`,
    "",
    "If you have any questions, we're always happy to help.",
    "",
    "booking@fairplayfootball.co.uk",
    "© Fair Play Football",
  ].join("\n") : [
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
    footerText: outcome === "completed"
      ? "Thank you for being part of Fair Play Football. If you have any questions, we're always happy to help."
      : outcome === "manual_review"
        ? "Thank you for your patience. If you have any questions, we're always happy to help."
        : outcome === "failed_credit_available"
          ? "If you have any questions, we're always happy to help."
          : undefined,
    introHtml: `
      <p style="margin:0 0 16px;color:#ffffff;font-size:16px;line-height:25px;">
        Hi ${escapeHtml(firstName)},
      </p>
      ${outcome === "manual_review" ? `
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          Your refund request for <strong>${escapeHtml(formattedAmount)}</strong> has been received but requires a manual review before it can be completed.
        </p>
        ${renderEmailParagraphs(outcomeCopy.paragraphs.slice(1))}
      ` : outcome === "failed_credit_available" ? `
        ${renderEmailParagraphs([outcomeCopy.paragraphs[0]])}
        <p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
          Instead, <strong>${escapeHtml(formattedAmount)}</strong> has been added to your Fair Play Wallet, where it's available to use immediately for future bookings.
        </p>
        ${renderEmailParagraphs(outcomeCopy.paragraphs.slice(2))}
      ` : renderEmailParagraphs(outcomeCopy.paragraphs)}
    `,
    cardHtml: outcome === "manual_review"
      ? renderPremiumInfoCard("Refund Details", [
          { label: "Amount", value: formattedAmount },
          { label: "Status", value: "Under Review" },
        ])
      : outcome === "failed_credit_available"
        ? renderPremiumInfoCard("Wallet Credit", [
            { label: "Amount", value: formattedAmount },
            { label: "Status", value: "Credit Available" },
          ])
      : outcome === "completed" && completedRefundDetails
      ? renderPremiumInfoCard("Refund Details", [
          { label: "Amount", value: formattedAmount },
          { label: "Original Payment Method", value: completedRefundDetails.paymentMethod },
          { label: "Refund Date", value: completedRefundDetails.refundDate },
          { label: "Reason", value: completedRefundDetails.reason },
        ])
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

  const result = await sendResendEmail({
    to: recipientEmail,
    subject: outcomeCopy.subject,
    html,
    text,
    idempotencyKey,
  });

  if (outcome === "completed") {
    await createRefundProcessedNotification({
      userId,
      refundRequestId,
      amount: Number(amount ?? 0),
    }).catch((notificationError) => {
      console.error("Unable to create refund processed notification:", {
        refundRequestId,
        userId,
        error: notificationError,
      });
    });
  }

  if (outcome === "failed_credit_available") {
    await createWalletCreditNotification({
      userId,
      amount: Number(amount ?? 0),
      reason: "Refund credited to your wallet",
      dedupeKey: `notification:wallet_credit_added:refund_request:${refundRequestId}`,
    }).catch((notificationError) => {
      console.error("Unable to create refund credited wallet notification:", {
        refundRequestId,
        userId,
        error: notificationError,
      });
    });
  }

  return result;
}
