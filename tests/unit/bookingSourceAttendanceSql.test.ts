import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(repoRoot, "supabase/migrations/20260922120000_add_booking_sources_and_attendance.sql"),
    "utf8"
  ).toLowerCase();
}

describe("Phase 1 booking source and attendance migration", () => {
  it("keeps historical bookings legacy and derives future sources in trusted triggers", () => {
    const sql = readMigration();

    expect(sql).toContain("add column if not exists booking_source text");
    expect(sql).toContain("set booking_source = 'legacy'");
    expect(sql).toContain("'fair_play', 'admin_manual', 'guest', 'third_party', 'legacy'");
    expect(sql).toContain("create table if not exists public.booking_source_config");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("on conflict (id) do nothing");
    expect(sql).not.toContain("2026-09-22 12:00:00");
    expect(sql).toContain("booking_payments_assign_source");
    expect(sql).toContain("wallet_transactions_assign_source");
    expect(sql).toContain("admin_booking_details_assign_source");
    expect(sql).toContain("booking_source = 'fair_play'");
    expect(sql).toContain("booking_source = case when new.booking_source = 'guest' then 'guest' else 'admin_manual' end");
    expect(sql).toContain("created_at >= (select launch_at from public.booking_source_config where id = true)");
    expect(sql).toContain("public.admin_booking_details is absent");
  });

  it("uses append-only attendance history and service-role-only writes", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.booking_attendance_history");
    expect(sql).toContain("previous_status");
    expect(sql).toContain("new_status");
    expect(sql).toContain("correction_reason");
    expect(sql).toContain("insert into public.booking_attendance_history");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.booking_attendance from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.booking_attendance_history from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.booking_attendance from service_role");
    expect(sql).toContain("revoke all on public.booking_attendance_history from service_role");
    expect(sql).toContain("grant select on public.booking_attendance to service_role");
    expect(sql).not.toContain("grant all on public.booking_attendance_history to service_role");
    expect(sql).toContain("grant execute on function public.admin_set_booking_attendance(bigint, text, uuid, text)");
  });

  it("validates the existing database admin convention before attendance writes", () => {
    const sql = readMigration();

    expect(sql).toContain("from public.admin_users");
    expect(sql).toContain("where user_id = p_marked_by");
    expect(sql).toContain("raise exception 'unauthorized admin'");
  });

  it("makes same-status attendance requests a complete current-state and history no-op", () => {
    const sql = readMigration();
    const sameStatusGuard = sql.indexOf("if v_current.booking_id is not null and v_current.status = p_status then");
    const historyInsert = sql.indexOf("insert into public.booking_attendance_history");
    const attendanceUpsert = sql.indexOf("return query insert into public.booking_attendance");

    expect(sameStatusGuard).toBeGreaterThan(-1);
    expect(historyInsert).toBeGreaterThan(sameStatusGuard);
    expect(attendanceUpsert).toBeGreaterThan(historyInsert);
    expect(sql).toContain("v_current.marked_by");
    expect(sql).toContain("v_current.marked_at");
    expect(sql).toContain("v_current.updated_at");
    expect(sql).toContain("v_current.correction_note");
  });

  it("keeps trusted future payment and admin metadata classification explicit", () => {
    const sql = readMigration();

    expect(sql).toContain("new.payment_status = 'paid'");
    expect(sql).toContain("new.transaction_type = 'wallet_booking_payment'");
    expect(sql).toContain("new.status = 'completed'");
    expect(sql).toContain("new.booking_source = 'guest'");
    expect(sql).toContain("booking_source = 'legacy'");
    expect(sql).toContain("and created_at >= (select launch_at from public.booking_source_config where id = true)");
  });
});
