import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(repoRoot, "supabase/migrations/20260922160000_add_email_referral_signup_acceptance.sql"),
    "utf8"
  ).toLowerCase();
}

describe("email referral signup acceptance migration", () => {
  it("validates codes without exposing referral identity", () => {
    const sql = readMigration();

    expect(sql).toContain("create or replace function public.validate_referral_code(p_code text)");
    expect(sql).toContain("upper(btrim(coalesce(p_code, '')))");
    expect(sql).toContain("select exists");
    expect(sql).not.toContain("returns table");
    expect(sql).toContain("returns boolean");
  });

  it("creates opaque expiring intents and keeps their table private", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.referral_signup_intents");
    expect(sql).toContain("id uuid primary key default gen_random_uuid()");
    expect(sql).toContain("expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes')");
    expect(sql).toContain("revoke all on public.referral_signup_intents from public, anon, authenticated, service_role");
    expect(sql).toContain("create or replace function public.create_referral_signup_intent(p_code text)");
    expect(sql).toContain("return null");
  });

  it("consumes each intent once for a new auth user and rejects invalid/self referrals", () => {
    const sql = readMigration();

    expect(sql).toContain("after insert on auth.users");
    expect(sql).toContain("referral_signup_intent_id");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_intent.consumed_at is not null");
    expect(sql).toContain("v_intent.expires_at <= clock_timestamp()");
    expect(sql).toContain("v_intent.referrer_user_id = new.id");
    expect(sql).toContain("on conflict (referred_user_id) do nothing");
    expect(sql).toContain("consumed_by_user_id = new.id");
  });

  it("preserves pending lifecycle states and creates no wallet value", () => {
    const sql = readMigration();

    expect(sql).toContain("accepted_code_snapshot");
    expect(sql).toContain("referrer-reward:' || new.id::text");
    expect(sql).toContain("referred-reward-unlock:' || new.id::text");
    expect(sql).not.toContain("wallet_transactions");
    expect(sql).not.toContain("create_wallet_credit_once");
    expect(sql).not.toContain("email_verification_state = 'verified'");
  });

  it("grants only the two anonymous validation/intent entry points", () => {
    const sql = readMigration();

    expect(sql).toContain("grant execute on function public.validate_referral_code(text) to anon, authenticated");
    expect(sql).toContain("grant execute on function public.create_referral_signup_intent(text) to anon, authenticated");
    expect(sql).toContain("revoke all on function public.create_referral_relationship_for_new_auth_user() from public, anon, authenticated, service_role");
    expect(sql).toContain("set search_path = public");
  });
});
