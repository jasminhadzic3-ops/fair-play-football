import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/game_archiving.sql"), "utf8");

describe("game archiving SQL", () => {
  it("adds nullable archive fields with operational-history comments", () => {
    expect(sql).toContain("add column if not exists archived_at timestamptz");
    expect(sql).toContain("add column if not exists archived_by uuid references auth.users(id) on delete set null");
    expect(sql).toContain("Archive is separate from active/cancelled lifecycle status");
    expect(sql).toContain("must never delete or rewrite financial/history records");
  });

  it("adds practical archive lookup indexes", () => {
    expect(sql).toContain("create index if not exists games_archived_at_idx");
    expect(sql).toContain("create index if not exists games_active_unarchived_starts_at_idx");
    expect(sql).toContain("create index if not exists games_archived_lookup_idx");
  });

  it("updates the service-role move RPC to reject archived targets", () => {
    expect(sql).toContain("create or replace function public.move_booking_if_space");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("if v_target_game.archived_at is not null then");
    expect(sql).toContain("'target_game_archived'");
    expect(sql).toContain("revoke all on function public.move_booking_if_space(bigint, bigint) from public");
    expect(sql).toContain("revoke all on function public.move_booking_if_space(bigint, bigint) from anon");
    expect(sql).toContain(
      "revoke all on function public.move_booking_if_space(bigint, bigint) from authenticated"
    );
    expect(sql).toContain("grant execute on function public.move_booking_if_space(bigint, bigint) to service_role");
  });
});
