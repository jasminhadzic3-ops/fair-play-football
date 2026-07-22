import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readSql(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8").toLowerCase();
}

describe("game reminder foundation SQL", () => {
  it("adds nullable structured kickoff timestamps to games", () => {
    const sql = readSql("supabase/game_reminder_foundation.sql");
    const baseSchema = readSql("supabase/base_schema.sql");

    expect(sql).toContain("alter table public.games");
    expect(sql).toContain("add column if not exists starts_at timestamptz");
    expect(sql).not.toContain("update public.games");
    expect(sql).not.toContain("set starts_at");
    expect(baseSchema).toContain("starts_at timestamptz");
  });

  it("creates durable reminder delivery records with one row per game and user", () => {
    const sql = readSql("supabase/game_reminder_foundation.sql");

    expect(sql).toContain("create table if not exists public.game_reminder_deliveries");
    expect(sql).toContain("game_id bigint not null references public.games(id) on delete cascade");
    expect(sql).toContain("user_id uuid not null references auth.users(id) on delete cascade");
    expect(sql).toContain("booking_id bigint not null references public.bookings(id) on delete cascade");
    expect(sql).toContain("check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'))");
    expect(sql).toContain("check (attempts >= 0)");
    expect(sql).toContain("(status = 'sent' and sent_at is not null)");
    expect(sql).toContain("game_reminder_deliveries_one_per_game_user_uidx");
    expect(sql).toContain("on public.game_reminder_deliveries(game_id, user_id)");
    expect(sql).toContain("game_reminder_deliveries_due_idx");
    expect(sql).toContain("where status in ('pending', 'failed')");
  });

  it("keeps delivery records server-only", () => {
    const sql = readSql("supabase/game_reminder_foundation.sql");

    expect(sql).toContain("alter table public.game_reminder_deliveries enable row level security");
    expect(sql).toContain("revoke all on table public.game_reminder_deliveries from anon");
    expect(sql).toContain("revoke all on table public.game_reminder_deliveries from authenticated");
    expect(sql).toContain("grant select, insert, update, delete on table public.game_reminder_deliveries to service_role");
    expect(sql).toContain("grant usage, select on sequence public.game_reminder_deliveries_id_seq to service_role");
  });

  it("does not store personal recipient data or raw provider responses", () => {
    const sql = readSql("supabase/game_reminder_foundation.sql");

    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("sanitized_error_code text");
    expect(sql).toContain("sanitized_error_message text");
    expect(sql).not.toContain("email text");
    expect(sql).not.toContain("player_name");
    expect(sql).not.toContain("raw_response");
    expect(sql).not.toContain("raw_provider");
  });
});
