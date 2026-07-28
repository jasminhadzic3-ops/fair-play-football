import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readSql(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8").toLowerCase();
}

describe("email delivery tracking SQL", () => {
  it("creates a server-only durable delivery ledger in the migration and base schema", () => {
    const migration = readSql("supabase/email_deliveries.sql");
    const baseSchema = readSql("supabase/base_schema.sql");

    for (const sql of [migration, baseSchema]) {
      expect(sql).toContain("create table if not exists public.email_deliveries");
      expect(sql).toContain("delivery_key text not null");
      expect(sql).toContain("email_type text not null");
      expect(sql).toContain("recipient_key text not null");
      expect(sql).toContain("booking_id bigint");
      expect(sql).toContain("game_id bigint");
      expect(sql).toContain("provider_message_id text");
      expect(sql).toContain("sanitized_error_message text");
      expect(sql).toContain("email_deliveries_delivery_key_uidx");
      expect(sql).toContain("on public.email_deliveries(delivery_key)");
      expect(sql).toContain("alter table public.email_deliveries enable row level security");
      expect(sql).toContain("revoke all on table public.email_deliveries from anon");
      expect(sql).toContain("revoke all on table public.email_deliveries from authenticated");
      expect(sql).toContain("grant select, insert, update, delete on table public.email_deliveries to service_role");
      expect(sql).toContain("grant usage, select on sequence public.email_deliveries_id_seq to service_role");
    }
  });

  it("limits delivery tracking to the approved email types", () => {
    const migration = readSql("supabase/email_deliveries.sql");

    expect(migration).toContain("check (email_type in ('booking_confirmation', 'game_half_full'))");
    expect(migration).toContain("check (status in ('sending', 'sent', 'failed'))");
  });

  it("adds claim and completion RPCs with durable duplicate and retry behaviour", () => {
    const migration = readSql("supabase/email_deliveries.sql");

    expect(migration).toContain("create or replace function public.claim_email_delivery");
    expect(migration).toContain("on conflict (delivery_key) do nothing");
    expect(migration).toContain("for update");
    expect(migration).toContain("#variable_conflict use_column");
    expect(migration).toContain("if v_delivery.status = 'sent' then");
    expect(migration).toContain("return query select v_delivery.id, false");
    expect(migration).toContain("v_delivery.claimed_at > now() - interval '10 minutes'");
    expect(migration).toContain("update public.email_deliveries as delivery");
    expect(migration).toContain("attempts = delivery.attempts + 1");
    expect(migration).toContain("metadata = coalesce(delivery.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)");
    expect(migration).toContain("returning delivery.* into v_delivery");
    expect(migration).toContain("create or replace function public.mark_email_delivery_sent");
    expect(migration).toContain("status = 'sent'");
    expect(migration).toContain("create or replace function public.mark_email_delivery_failed");
    expect(migration).toContain("status = 'failed'");
  });

  it("does not store recipient email, player names, raw provider payloads, or secrets", () => {
    const migration = readSql("supabase/email_deliveries.sql");

    expect(migration).not.toContain("email text");
    expect(migration).not.toContain("recipient_email");
    expect(migration).not.toContain("player_name");
    expect(migration).not.toContain("raw_response");
    expect(migration).not.toContain("raw_provider");
    expect(migration).not.toContain("api_key");
  });
});
