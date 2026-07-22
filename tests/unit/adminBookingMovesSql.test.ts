import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/admin_booking_moves.sql"), "utf8");

describe("admin booking moves SQL", () => {
  it("defines a service-role-only atomic move RPC", () => {
    expect(sql).toContain("create or replace function public.move_booking_if_space");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function public.move_booking_if_space(bigint, bigint) from public");
    expect(sql).toContain("revoke all on function public.move_booking_if_space(bigint, bigint) from anon");
    expect(sql).toContain(
      "revoke all on function public.move_booking_if_space(bigint, bigint) from authenticated"
    );
    expect(sql).toContain("grant execute on function public.move_booking_if_space(bigint, bigint) to service_role");
  });

  it("locks the booking and source/target games deterministically", () => {
    expect(sql).toContain("from public.bookings");
    expect(sql).toContain("where id = p_booking_id");
    expect(sql).toContain("for update");
    expect(sql).toContain("where id in (v_booking.game_id, p_target_game_id)");
    expect(sql).toContain("order by id");
  });

  it("rejects invalid or unsafe move destinations", () => {
    [
      "invalid_booking",
      "invalid_target_game",
      "booking_not_found",
      "booking_missing_game",
      "same_game",
      "target_game_not_found",
      "target_game_cancelled",
      "target_game_not_active",
      "target_game_missing_starts_at",
      "target_game_past",
      "target_game_full",
    ].forEach((reason) => expect(sql).toContain(`'${reason}'`));
  });

  it("blocks bookings with cancellation or refund history", () => {
    expect(sql).toContain("transaction_type = 'game_cancelled_credit'");
    expect(sql).toContain("transaction_type in ('refund_requested', 'refund_completed')");
    expect(sql).toContain("from public.sumup_refund_attempts");
    expect(sql).toContain("booking_payments.booking_id = v_booking.id");
    expect(sql).toContain("refund_requests.booking_id = v_booking.id");
    expect(sql).toContain("'booking_has_cancellation_history'");
    expect(sql).toContain("'booking_has_refund_history'");
  });

  it("blocks ambiguous SumUp or wallet booking payment history", () => {
    expect(sql).toContain("v_paid_booking_payment_count");
    expect(sql).toContain("v_non_paid_booking_payment_count");
    expect(sql).toContain("booking_payments.payment_status = 'paid'");
    expect(sql).toContain("booking_payments.payment_status <> 'paid'");
    expect(sql).toContain("v_paid_booking_payment_count > 1");
    expect(sql).toContain("v_non_paid_booking_payment_count > 0");

    expect(sql).toContain("v_valid_wallet_booking_payment_count");
    expect(sql).toContain("v_ambiguous_wallet_booking_payment_count");
    expect(sql).toContain("wallet_transactions.transaction_type = 'wallet_booking_payment'");
    expect(sql).toContain("wallet_transactions.status = 'completed'");
    expect(sql).toContain("wallet_transactions.amount < 0");
    expect(sql).toContain("v_valid_wallet_booking_payment_count > 1");
    expect(sql).toContain("v_ambiguous_wallet_booking_payment_count > 0");
    expect(sql).toContain("(v_paid_booking_payment_count = 1 and v_valid_wallet_booking_payment_count = 1)");
    expect(sql).toContain("'booking_has_ambiguous_payment_history'");
  });

  it("allows a single paid SumUp payment predicate to move and blocks non-current SumUp rows", () => {
    expect(sql).not.toContain("v_paid_booking_payment_count > 0");
    expect(sql).toContain("v_paid_booking_payment_count > 1");
    expect(sql).toContain("v_non_paid_booking_payment_count > 0");
    expect(sql).toContain("where booking_payments.booking_id = v_booking.id\n    and booking_payments.payment_status = 'paid'");
    expect(sql).toContain("where booking_id = v_booking.id\n    and payment_status = 'paid'");
  });

  it("allows a single completed negative wallet booking debit and blocks ambiguous wallet rows", () => {
    expect(sql).not.toContain("v_valid_wallet_booking_payment_count > 0");
    expect(sql).toContain("v_valid_wallet_booking_payment_count > 1");
    expect(sql).toContain("v_ambiguous_wallet_booking_payment_count > 0");
    expect(sql).toContain("wallet_transactions.status = 'completed'\n    and wallet_transactions.amount < 0");
    expect(sql).toContain("and not (\n      wallet_transactions.status = 'completed'\n      and wallet_transactions.amount < 0\n    )");
    expect(sql).toContain("and transaction_type = 'wallet_booking_payment'\n    and status = 'completed'\n    and amount < 0");
  });

  it("blocks mixed SumUp and wallet booking payment history", () => {
    expect(sql).toContain("(v_paid_booking_payment_count = 1 and v_valid_wallet_booking_payment_count = 1)");
  });

  it("moves only current booking fulfilment records and preserves historical refund records", () => {
    expect(sql).toContain("update public.bookings");
    expect(sql).toContain("set game_id = p_target_game_id");
    expect(sql).toContain("update public.booking_payments");
    expect(sql).toContain("where booking_id = v_booking.id");
    expect(sql).toContain("and payment_status = 'paid'");
    expect(sql).toContain("update public.wallet_transactions");
    expect(sql).toContain("transaction_type = 'wallet_booking_payment'");
    expect(sql).toContain("and status = 'completed'");
    expect(sql).toContain("and amount < 0");
    expect(sql).toContain("'moved_from_game_id'");
    expect(sql).toContain("'moved_to_game_id'");
    expect(sql).toContain("'moved_at'");
    expect(sql).not.toContain("transaction_type = 'game_cancelled_credit'\n    set");
    expect(sql).not.toContain("update public.sumup_refund_attempts");
  });
});
