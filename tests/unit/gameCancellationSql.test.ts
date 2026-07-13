import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(process.cwd(), "supabase/game_cancellations.sql"), "utf8");

describe("game cancellation SQL", () => {
  it("defines one trusted atomic cancellation RPC", () => {
    expect(sql).toContain("create or replace function public.cancel_game_with_wallet_credits");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("from public.games");
    expect(sql).toContain("for update");
    expect(sql).toContain("from public.bookings");
    expect(sql).toContain("where bookings.game_id = p_game_id");
  });

  it("creates cancellation credits and cancels the game in the RPC transaction", () => {
    expect(sql).toContain("insert into public.wallet_transactions");
    expect(sql).toContain("'game_cancelled_credit'");
    expect(sql).toContain("'game_cancelled_credit:game:' || p_game_id::text || ':payment:'");
    expect(sql).toContain("'game_cancelled_credit:game:' || p_game_id::text || ':wallet_transaction:'");
    expect(sql).toContain("update public.games");
    expect(sql).toContain("status = 'cancelled'");
    expect(sql).toContain("cancelled_at = now()");
    expect(sql).toContain("cancelled_by = p_admin_user_id");
  });

  it("fails safely for duplicate, mixed, or mismatched payment sources", () => {
    expect(sql).toContain("mismatched booking user details");
    expect(sql).toContain("multiple paid SumUp payment records");
    expect(sql).toContain("multiple wallet booking payment records");
    expect(sql).toContain("both SumUp and wallet payment records");
    expect(sql).toContain("raise exception");
  });

  it("preserves paid_no_space rows by only crediting linked paid bookings", () => {
    expect(sql).toContain("booking_payments.booking_id = bookings.id");
    expect(sql).toContain("booking_payments.payment_status = 'paid'");
    expect(sql).not.toContain("payment_status = 'paid_no_space'");
  });

  it("marks waiting-list rows removed without deleting history", () => {
    expect(sql).toContain("update public.waiting_list");
    expect(sql).toContain("set status = 'removed'");
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.waiting_list\b/i);
  });

  it("restricts RPC execution to service_role", () => {
    expect(sql).toContain("revoke all on function public.cancel_game_with_wallet_credits");
    expect(sql).toContain("from public");
    expect(sql).toContain("from anon");
    expect(sql).toContain("from authenticated");
    expect(sql).toContain("grant execute on function public.cancel_game_with_wallet_credits");
    expect(sql).toContain("to service_role");
  });
});
