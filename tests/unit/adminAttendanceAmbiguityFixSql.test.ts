import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(
      repoRoot,
      "supabase/migrations/20260923100000_fix_admin_booking_attendance_ambiguity.sql"
    ),
    "utf8"
  ).toLowerCase();
}

describe("admin attendance ambiguity follow-up migration", () => {
  it("preserves the exact RPC signature, return shape and security contract", () => {
    const sql = readMigration();

    expect(sql).toContain(
      "create or replace function public.admin_set_booking_attendance(\n  p_booking_id bigint,\n  p_status text,\n  p_marked_by uuid,\n  p_correction_reason text default null\n)"
    );
    expect(sql).toContain("returns table (");
    expect(sql).toContain("booking_id bigint");
    expect(sql).toContain("game_id bigint");
    expect(sql).toContain("user_id uuid");
    expect(sql).toContain("status text");
    expect(sql).toContain("marked_by uuid");
    expect(sql).toContain("marked_at timestamptz");
    expect(sql).toContain("updated_at timestamptz");
    expect(sql).toContain("correction_note text");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "grant execute on function public.admin_set_booking_attendance(bigint, text, uuid, text)\n  to service_role"
    );
  });

  it("qualifies all collision-prone attendance lookups", () => {
    const sql = readMigration();

    expect(sql).toContain("from public.admin_users as admin_user\n    where admin_user.user_id = p_marked_by");
    expect(sql).toContain("from public.bookings as booking\n  where booking.id = p_booking_id");
    expect(sql).toContain(
      "from public.booking_attendance as attendance\n  where attendance.booking_id = p_booking_id"
    );
    expect(sql).not.toMatch(/from public\.admin_users\s*\n\s*where user_id\s*=/);
    expect(sql).not.toMatch(/from public\.bookings\s*\n\s*where id\s*=/);
    expect(sql).not.toMatch(/from public\.booking_attendance\s*\n\s*where booking_id\s*=/);
  });

  it("preserves attendance history and same-status no-op behaviour", () => {
    const sql = readMigration();

    expect(sql).toContain("from public.admin_users as admin_user");
    expect(sql).toContain("for update;");
    expect(sql).toContain("if v_current.booking_id is not null and v_current.status = p_status then");
    expect(sql).toContain("insert into public.booking_attendance_history");
    expect(sql).toContain("previous_status, new_status, changed_by, correction_reason");
    expect(sql).toContain(
      "on conflict on constraint booking_attendance_pkey do update set"
    );
    expect(sql).not.toContain("on conflict (booking_id)");
    expect(sql).not.toContain("wallet_transactions");
    expect(sql).not.toContain("referral");
    expect(sql).not.toContain("loyalty");
  });
});
