import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminPageSource = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");

describe("admin archive UI source", () => {
  it("adds a dedicated archived filter and excludes archived games from normal filters", () => {
    expect(adminPageSource).toContain('{ value: "archived", label: "Archived" }');
    expect(adminPageSource).toContain('gameFilter === "archived"');
    expect(adminPageSource).toContain("!archived &&");
  });

  it("renders compact archived cards with safe summary fields and restore action", () => {
    expect(adminPageSource).toContain("formatArchiveDate(game.archived_at)");
    expect(adminPageSource).toContain("financialSummary.totalPaidSumUpAmount");
    expect(adminPageSource).toContain("financialSummary.totalRefundedAmount");
    expect(adminPageSource).toContain("financialSummary.paymentCount");
    expect(adminPageSource).toContain("financialSummary.cancellationCreditCount");
    expect(adminPageSource).toContain("financialSummary.completedRefundCount");
    expect(adminPageSource).toContain("Restore");
    expect(adminPageSource).toContain("Expand");
    expect(adminPageSource).toContain("Booked-player history");
  });

  it("keeps full financial records collapsed behind explicit expansion", () => {
    expect(adminPageSource).toContain("const financialRecords = game.financial_records ?? []");
    expect(adminPageSource).toContain("financialRecords.length > 0");
    expect(adminPageSource).toContain("Financial records");
    expect(adminPageSource).not.toContain("<details open");
  });

  it("shows safe archive confirmation copy before hiding a game from normal filters", () => {
    expect(adminPageSource).toContain('Archive "${game.title}"?');
    expect(adminPageSource).toContain("It will disappear from normal Admin filters and public booking.");
    expect(adminPageSource).toContain("No payment, wallet, refund, booking, or cancellation history will be deleted.");
    expect(adminPageSource).toContain("It remains available under Archived and can be restored later.");
  });
});
