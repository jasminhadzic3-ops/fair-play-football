import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(process.cwd(), "supabase/wallet.sql"), "utf8");

describe("wallet SQL", () => {
  it("enforces one completed refund debit per refund request", () => {
    expect(sql).toContain(
      "create unique index if not exists wallet_refund_completed_one_debit_per_request_uidx"
    );
    expect(sql).toContain("on public.wallet_transactions((metadata->>'refund_request_id'))");
    expect(sql).toContain("where transaction_type = 'refund_completed'");
    expect(sql).toContain("and status = 'completed'");
    expect(sql).toContain("and metadata ? 'refund_request_id'");
    expect(sql).toContain("and (metadata->>'refund_request_id') ~ '^[0-9]+$'");
  });

  it("keeps refund request reservation uniqueness separate from refund completion uniqueness", () => {
    expect(sql).toContain(
      "create unique index if not exists wallet_refund_requests_one_active_per_source_credit_uidx"
    );
    expect(sql).toContain("on public.wallet_transactions((metadata->>'source_wallet_transaction_id'))");
    expect(sql).toContain("where transaction_type = 'refund_requested'");
    expect(sql).toContain("and status in ('pending', 'processing', 'completed')");
  });

  it("allows player-cancellation credits to be requested back from the Wallet", () => {
    expect(sql).toContain(
      "v_source_credit.transaction_type not in ('game_cancelled_credit', 'player_cancelled_credit')"
    );
    expect(sql).toContain(
      "'refund_requested:source_credit:' || v_source_credit.id::text || ':request:' || txid_current()::text"
    );
  });

  it("writes the same refund request identifier for manual and automatic refund completions", () => {
    expect(sql).toContain("'refund_request_id', v_refund_request.id");
    expect(sql).toContain("v_metadata := coalesce(v_refund_request.metadata, '{}'::jsonb) ||");
    expect(sql).toContain("'refund_completed_transaction_id', v_transaction_id");
  });

  it("rejects wallet bookings for non-bookable game lifecycle states before debiting", () => {
    expect(sql).toContain("create or replace function public.create_wallet_booking_if_balance");
    expect(sql).toContain("games.starts_at, games.archived_at");
    expect(sql).toContain("if v_game_status = 'cancelled' then");
    expect(sql).toContain("'game_cancelled'");
    expect(sql).toContain("if v_game_archived_at is not null then");
    expect(sql).toContain("'game_archived'");
    expect(sql).toContain("if v_game_status <> 'active' then");
    expect(sql).toContain("'game_not_bookable'");
    expect(sql).toContain("if v_game_starts_at is null then");
    expect(sql).toContain("if v_game_starts_at <= now() then");
    expect(sql).toContain("'game_completed'");
  });
});
