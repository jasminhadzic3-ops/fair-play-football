import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(root, "supabase/migrations/20260924140000_add_free_games_foundation.sql"),
  "utf8"
).toLowerCase();

describe("Free Games foundation migration", () => {
  it("backfills paid games and enforces an authoritative paid/free price invariant", () => {
    expect(sql).toContain("add column if not exists pricing_mode text");
    expect(sql).toContain("set pricing_mode = 'paid'");
    expect(sql).toContain("pricing_mode in ('paid', 'free')");
    expect(sql).toContain("pricing_mode = 'paid' and price > 0");
    expect(sql).toContain("pricing_mode = 'free' and price = 0");
    expect(sql).toContain("cannot install free games pricing invariants");
  });

  it("creates a service-role-only, locked, idempotent free booking without financial rows", () => {
    expect(sql).toContain("create_free_booking_if_space");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_game.pricing_mode <> 'free'");
    expect(sql).toContain("v_game.price is distinct from 0");
    expect(sql).toContain("v_game.max_players is null or v_game.max_players <= 0");
    expect(sql).toContain("booking_source)\n  values (p_game_id, p_user_id, v_player_name, 'fair_play')");
    expect(sql).toContain("return query select true, v_booking_id, false");
    expect(sql).toContain("grant execute on function public.create_free_booking_if_space(uuid, bigint, text)\n  to service_role");
    expect(sql).not.toContain("insert into public.booking_payments");
    expect(sql).not.toContain("insert into public.wallet_transactions");
  });

  it("cancels a free booking with an explicit non-financial audit representation", () => {
    expect(sql).toContain("payment_method in ('sumup', 'wallet', 'free', 'legacy')");
    expect(sql).toContain("'not_applicable'");
    expect(sql).toContain("create or replace function public.cancel_free_booking");
    expect(sql).toContain("'free_booking_cancelled'");
    expect(sql).toContain("free_booking_has_financial_history");
    expect(sql).toContain("delete from public.bookings");
  });

  it("adds the paid-game boundary to the authoritative loyalty and referral candidate functions", () => {
    expect(sql).toContain("public.reconcile_loyalty_rewards(integer)");
    expect(sql).toContain("public.find_referral_reward_candidate(uuid,timestamptz,timestamptz,interval,boolean,bigint,bigint,boolean)");
    expect(sql).toContain("game.pricing_mode = ''paid''");
    expect(sql).not.toContain("booking_attendance");
  });
});
