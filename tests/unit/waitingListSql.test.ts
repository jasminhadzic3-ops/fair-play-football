import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(process.cwd(), "supabase/waiting_list.sql"), "utf8").toLowerCase();

describe("waiting list SQL", () => {
  it("grants the table and sequence privileges required by the app flow", () => {
    expect(sql).toContain("grant select, insert, delete on public.waiting_list to authenticated");
    expect(sql).toContain("grant usage, select on sequence public.waiting_list_id_seq to authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.waiting_list to service_role");
    expect(sql).toContain("grant usage, select on sequence public.waiting_list_id_seq to service_role");
  });

  it("keeps authenticated writes constrained by owner RLS policies", () => {
    expect(sql).toContain("alter table public.waiting_list enable row level security");
    expect(sql).toContain("for insert");
    expect(sql).toContain("auth.uid() = user_id");
    expect(sql).toContain("status = 'waiting'");
    expect(sql).toContain("for delete");
    expect(sql).toContain("using (auth.uid() = user_id)");
    expect(sql).not.toContain("grant all on public.waiting_list to authenticated");
  });

  it("guards direct waiting-list inserts to full active upcoming games", () => {
    expect(sql).toContain("games.status = 'active'");
    expect(sql).toContain("games.archived_at is null");
    expect(sql).toContain("games.starts_at is not null");
    expect(sql).toContain("games.starts_at > now()");
    expect(sql).toContain("from public.bookings");
    expect(sql).toContain("bookings.game_id = waiting_list.game_id");
    expect(sql).toContain(") >= games.max_players");
  });
});
