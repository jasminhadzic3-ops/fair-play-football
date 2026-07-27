import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/player_booking_cancellations.sql"),
  "utf8"
);

describe("player booking cancellation SQL", () => {
  it("creates a durable audit table without a restrictive booking foreign key", () => {
    expect(sql).toContain("create table if not exists public.player_booking_cancellations");
    expect(sql).toContain("booking_id bigint not null");
    expect(sql).toContain("Historical booking id snapshot");
    expect(sql).not.toContain("booking_id bigint not null references public.bookings");
    expect(sql).toContain("player_booking_cancellations_one_per_booking_uidx");
  });

  it("adds explicit idempotency protections for cancellation credits and refund requests", () => {
    expect(sql).toContain("wallet_player_cancelled_credit_one_sumup_source_uidx");
    expect(sql).toContain("wallet_player_cancelled_credit_one_wallet_source_uidx");
    expect(sql).toContain("wallet_refund_requests_one_active_per_source_credit_uidx");
    expect(sql).toContain("'player_cancelled_credit:booking:' || v_booking.id::text || ':payment:'");
    expect(sql).toContain("'player_cancelled_credit:booking:' || v_booking.id::text || ':wallet_transaction:'");
  });

  it("uses the exact 24-hour starts_at boundary and blocks missing starts_at", () => {
    expect(sql).toContain("v_game.starts_at is null");
    expect(sql).toContain("'missing_starts_at'");
    expect(sql).toContain("v_game.starts_at - now() >= interval '24 hours'");
  });

  it("fails closed for ambiguous payment history", () => {
    expect(sql).toContain("v_paid_booking_payment_count > 1");
    expect(sql).toContain("v_non_paid_booking_payment_count > 0");
    expect(sql).toContain("v_valid_wallet_booking_payment_count > 1");
    expect(sql).toContain("v_ambiguous_wallet_booking_payment_count > 0");
    expect(sql).toContain("booking_has_ambiguous_payment_history");
    expect(sql).toContain("booking_has_no_refundable_payment_source");
  });

  it("records SumUp source credit and refund request before releasing the booking", () => {
    const auditInsertIndex = sql.indexOf("insert into public.player_booking_cancellations");
    const sourceCreditIndex = sql.indexOf("Credit reserved for player cancellation card refund");
    const refundRequestIndex = sql.indexOf("'refund_mode', 'player_cancellation_24h'");
    const deleteIndex = sql.indexOf("delete from public.bookings");

    expect(auditInsertIndex).toBeGreaterThan(-1);
    expect(sourceCreditIndex).toBeGreaterThan(auditInsertIndex);
    expect(refundRequestIndex).toBeGreaterThan(sourceCreditIndex);
    expect(deleteIndex).toBeGreaterThan(refundRequestIndex);
    expect(sql).toContain("'reserved_for_card_refund', true");
  });

  it("restores wallet-paid bookings without creating a SumUp refund request", () => {
    expect(sql).toContain("'original_payment_method', 'wallet'");
    expect(sql).toContain("'original_wallet_transaction_id', v_valid_wallet_booking_payment.id");
    expect(sql).toContain("'Wallet credit for player cancellation'");
    expect(sql).toContain("v_refund_request_id");
  });

  it("keeps the RPC service-role only", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function public.cancel_player_booking_with_refund_policy");
    expect(sql).toContain("from anon");
    expect(sql).toContain("from authenticated");
    expect(sql).toContain("to service_role");
  });
});
