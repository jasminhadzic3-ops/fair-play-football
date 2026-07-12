import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readSql(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8").toLowerCase();
}

describe("atomic paid checkout finalisation SQL", () => {
  it("keeps paid checkout booking and payment updates inside one service-role RPC", () => {
    const sql = readSql("supabase/atomic_paid_checkout_finalisation.sql");
    const sumupPayments = readFileSync(resolve(repoRoot, "lib/sumupPayments.ts"), "utf8");

    expect(sql).toContain("create or replace function public.finalize_paid_sumup_checkout");
    expect(sql).toContain("from public.booking_payments");
    expect(sql).toContain("for update");
    expect(sql).toContain("from public.games");
    expect(sql).toContain("insert into public.bookings");
    expect(sql).toContain("payment_status = 'paid'");
    expect(sql).toContain("payment_status = 'paid_no_space'");
    expect(sql).toContain("v_game_status = 'cancelled'");
    expect(sql).toContain("revoke all on function public.finalize_paid_sumup_checkout");
    expect(sql).toContain("from authenticated");
    expect(sql).toContain("grant execute on function public.finalize_paid_sumup_checkout");
    expect(sql).toContain("to service_role");

    expect(sumupPayments).toContain('.rpc("finalize_paid_sumup_checkout"');
    expect(sumupPayments).not.toContain('.rpc("create_booking_if_space"');
  });
});
