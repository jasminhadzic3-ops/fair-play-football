import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function extractSection(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("SumUp incomplete payment handling", () => {
  it("keeps successful payment return behaviour unchanged", () => {
    const homeSource = readSource("components/home/HomeClient.tsx");
    const paidBranch = extractSection(
      homeSource,
      'if (paymentStatus === "paid" || paymentStatus === "successful")',
      'if (paymentStatus === "paid_no_space")'
    );

    expect(paidBranch).toContain('localStorage.setItem("fairPlayBookingsUpdatedAt"');
    expect(paidBranch).toContain("setSuccessGameId(paidGameId)");
    expect(paidBranch).toContain('setReturnPaymentState("paid")');
    expect(paidBranch).toContain("Payment confirmed. Your booking has been added.");
  });

  it("treats cancelled, failed and expired return statuses as incomplete payments", () => {
    const homeSource = readSource("components/home/HomeClient.tsx");
    const incompleteBranch = extractSection(
      homeSource,
      "if (terminalIncompletePaymentStatuses.has(paymentStatus))",
      "await new Promise"
    );

    expect(homeSource).toContain('"Payment wasn\'t completed.\\nYour booking has not been confirmed."');
    expect(homeSource).toContain('new Set(["cancelled", "canceled", "failed", "expired"])');
    expect(incompleteBranch).toContain("setPaymentReturnTargetGameId(incompleteGameId)");
    expect(incompleteBranch).toContain("await showIncompletePaymentReturn(incompleteGameId)");
    expect(incompleteBranch).not.toContain('setReturnPaymentState("pending")');
  });

  it("shows recovery actions instead of leaving the return page in an infinite loading state", () => {
    const homeSource = readSource("components/home/HomeClient.tsx");
    const timeoutBranch = extractSection(
      homeSource,
      "const incompleteGameId = Number(localStorage.getItem(\"pendingSumUpGameId\")) || null;",
      "async function runPostAuthWork"
    );

    expect(timeoutBranch).toContain("await showIncompletePaymentReturn(incompleteGameId)");
    expect(homeSource).toContain("Try Again");
    expect(homeSource).toContain("Back to Game");
    expect(homeSource).toContain("retryReturnedPayment");
    expect(homeSource).toContain("returnBackToGame");
  });

  it("lets Try Again reopen the game payment modal for browser Back returns", () => {
    const homeSource = readSource("components/home/HomeClient.tsx");
    const detailsSource = readSource("components/games/GameDetails.tsx");

    expect(homeSource).toContain("const [retryPaymentGameId, setRetryPaymentGameId]");
    expect(homeSource).toContain("setRetryPaymentGameId(gameId)");
    expect(homeSource).toContain("continueToPayment={retryPaymentGameId === game.id}");
    expect(detailsSource).toContain("if (continueToPayment) {");
    expect(detailsSource).toContain("openPaymentModal()");
  });

  it("marks a closed or abandoned modal checkout as failed after the polling timeout", () => {
    const detailsSource = readSource("components/games/GameDetails.tsx");
    const timeoutBranch = extractSection(
      detailsSource,
      "const timeout = window.setTimeout(() => {",
      "return () => {"
    );

    expect(detailsSource).toContain('new Set(["cancelled", "canceled", "failed", "expired"])');
    expect(timeoutBranch).toContain('setPaymentStatus("failed")');
    expect(timeoutBranch).toContain("setPaymentMessage(incompletePaymentMessage)");
    expect(timeoutBranch).toContain("setPaymentCheckoutId(null)");
    expect(timeoutBranch).toContain("setPaymentCheckoutReference(null)");
    expect(timeoutBranch).not.toContain("Payment is still processing");
  });

  it("normalizes raw SumUp cancelled statuses before persisting to the constrained payment status column", () => {
    const sumupPaymentsSource = readSource("lib/sumupPayments.ts");

    expect(sumupPaymentsSource).toContain('rawStatus === "cancelled" || rawStatus === "canceled"');
    expect(sumupPaymentsSource).toContain('? "failed" : rawStatus');
  });
});
