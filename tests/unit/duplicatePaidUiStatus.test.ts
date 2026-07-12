import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { duplicatePaidPaymentMessage } from "@/lib/sumupPaymentMessages";

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

describe("duplicate paid checkout UI status", () => {
  it("uses calm reconciliation copy without success or processing wording", () => {
    expect(duplicatePaidPaymentMessage).toContain("Payment received");
    expect(duplicatePaidPaymentMessage).toContain("Please do not pay again");
    expect(duplicatePaidPaymentMessage).toContain("organiser");
    expect(duplicatePaidPaymentMessage).toContain("refund");
    expect(duplicatePaidPaymentMessage).not.toContain("Payment confirmed");
    expect(duplicatePaidPaymentMessage).not.toContain("still processing");
    expect(duplicatePaidPaymentMessage).not.toContain("database");
  });

  it("stops homepage return polling for duplicate_paid without showing success", () => {
    const pageSource = readSource("app/page.tsx");
    const duplicateBranch = extractSection(
      pageSource,
      'if (paymentStatus === "duplicate_paid")',
      'if (paymentStatus === "failed" || paymentStatus === "expired")'
    );

    expect(pageSource).toContain('"duplicate_paid" | "pending"');
    expect(duplicateBranch).toContain('setReturnPaymentState("duplicate_paid")');
    expect(duplicateBranch).toContain("duplicatePaidPaymentMessage");
    expect(duplicateBranch).toContain("return;");
    expect(duplicateBranch).not.toContain("setSuccessGameId");
    expect(duplicateBranch).not.toContain("fairPlayBookingsUpdatedAt");
    expect(duplicateBranch).not.toContain("Payment confirmed");
    expect(duplicateBranch).not.toContain("Payment is still processing");
  });

  it("handles duplicate_paid inside GameDetails without normal post-booking completion", () => {
    const detailsSource = readSource("components/games/GameDetails.tsx");
    const duplicateBranch = extractSection(
      detailsSource,
      'if (result.paymentStatus === "duplicate_paid")',
      'if (result.paymentStatus === "failed" || result.paymentStatus === "expired")'
    );

    expect(detailsSource).toContain('"duplicate_paid" | "failed"');
    expect(duplicateBranch).toContain('setPaymentStatus("duplicate_paid")');
    expect(duplicateBranch).toContain("duplicatePaidPaymentMessage");
    expect(duplicateBranch).toContain("return;");
    expect(duplicateBranch).not.toContain("onPaymentComplete");
    expect(duplicateBranch).not.toContain("fairPlayBookingsUpdatedAt");
    expect(duplicateBranch).not.toContain("Payment confirmed");
    expect(duplicateBranch).not.toContain("still processing");
  });
});
