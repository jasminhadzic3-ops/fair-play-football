import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readMigration() {
  return readFileSync(
    resolve(repoRoot, "supabase/migrations/20260922150000_add_referral_code_foundation.sql"),
    "utf8"
  ).toLowerCase();
}

describe("referral code foundation migration", () => {
  it("creates exactly one globally unique, uppercase code per user", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.referral_codes");
    expect(sql).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
    expect(sql).toContain("code text not null unique");
    expect(sql).toContain("check (code = upper(code))");
    expect(sql).toContain("check (code ~ '^[a-z2-9]{4,15}$')");
  });

  it("derives a safe readable prefix from the existing username and has a deterministic fallback", () => {
    const sql = readMigration();

    expect(sql).toContain("create or replace function public.referral_code_prefix(");
    expect(sql).toContain("p_username text");
    expect(sql).toContain("split_part(");
    expect(sql).toContain("regexp_replace(btrim(coalesce(p_username, '')), '\\s+', ' ', 'g')");
    expect(sql).toContain("regexp_replace(coalesce(v_first_name, ''), '[^a-za-z]', '', 'g')");
    expect(sql).toContain("return 'player';");
    expect(sql).toContain("return left(v_prefix, 12);");
  });

  it("uses a three-character random suffix without visually confusing O/0 or I/1", () => {
    const sql = readMigration();

    expect(sql).toContain("v_suffix_alphabet constant text := 'abcdefghjklmnpqrstuvwxyz23456789'");
    expect(sql).toContain("gen_random_uuid()");
    expect(sql).toContain("((v_random_value >> 10) & 31) + 1");
    expect(sql).toContain("((v_random_value >> 5) & 31) + 1");
    expect(sql).toContain("(v_random_value & 31) + 1");
  });

  it("retries safely for code collisions and concurrent per-user creation", () => {
    const sql = readMigration();

    expect(sql).toContain("for v_attempt in 1..100 loop");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("where referral_code.user_id = p_user_id");
    expect(sql).toContain("unable to generate a unique referral code");
  });

  it("creates codes only through trusted database code for new and existing profiles", () => {
    const sql = readMigration();

    expect(sql).toContain("create or replace function public.ensure_referral_code(");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("create trigger create_referral_code_after_profile_insert");
    expect(sql).toContain("after insert on public.profiles");
    expect(sql).toContain("perform public.ensure_referral_code(new.id, new.username);");
    expect(sql).toContain("backfill exactly one immutable code for every existing player profile");
  });

  it("models exactly one auditable referral relationship per referred player", () => {
    const sql = readMigration();

    expect(sql).toContain("create table if not exists public.referral_relationships");
    expect(sql).toContain("referrer_user_id uuid not null references auth.users(id) on delete restrict");
    expect(sql).toContain("referred_user_id uuid not null unique references auth.users(id) on delete cascade");
    expect(sql).toContain("accepted_code_snapshot text not null");
    expect(sql).toContain("referral_relationships_not_self_referral");
    expect(sql).toContain("check (referrer_user_id <> referred_user_id)");
    expect(sql).toContain("accepted_code_snapshot = upper(accepted_code_snapshot)");
    expect(sql).toContain("accepted_code_snapshot ~ '^[a-z2-9]{4,15}$'");
  });

  it("records verification and both £5 reward lifecycles without issuing wallet value", () => {
    const sql = readMigration();

    expect(sql).toContain("email_verification_state text not null default 'pending_verification'");
    expect(sql).toContain("email_verified_at timestamptz");
    expect(sql).toContain("referrer_reward_amount numeric(10, 2) not null default 5.00");
    expect(sql).toContain("referred_reward_amount numeric(10, 2) not null default 5.00");
    expect(sql).toContain("referrer_reward_state text not null default 'pending_verification'");
    expect(sql).toContain("referred_reward_state text not null default 'pending_verification'");
    expect(sql).toContain("referral_relationships_referrer_reward_state_allowed_check");
    expect(sql).toContain("referral_relationships_referred_reward_state_allowed_check");
    expect(sql).toContain("referred_reward_state = 'locked'");
    expect(sql).toContain("referred_reward_state = 'unlocked'");
    expect(sql).toContain("referral_relationships_verified_lifecycle_check");
    expect(sql).toContain("referrer_reward_state in ('eligible', 'credited')");
    expect(sql).toContain("referred_reward_state in ('locked', 'unlocked')");
    expect(sql).toContain("referrer_reward_wallet_transaction_id bigint unique");
    expect(sql).toContain("referred_reward_wallet_transaction_id bigint unique");
    expect(sql).toContain("referral_relationships_referred_reward_state_check");
    expect(sql).not.toContain("create_wallet_credit_once(");
    expect(sql).not.toContain("insert into public.wallet_transactions");
  });

  it("keeps the referred reward outside the spendable wallet until a later attended unlock", () => {
    const sql = readMigration();

    expect(sql).toContain("referred_reward_unlock_booking_id bigint");
    expect(sql).toContain("referred_reward_unlock_game_id bigint");
    expect(sql).toContain("referred_reward_unlocked_at timestamptz");
    expect(sql).toContain("referred_reward_unlock_idempotency_key text not null unique");
    expect(sql).toContain("referred_reward_state = 'locked'");
    expect(sql).toContain("referred_reward_wallet_transaction_id is null");
    expect(sql).toContain("referred_reward_state = 'unlocked'");
    expect(sql).toContain("referred_reward_wallet_transaction_id is not null");
    expect(sql).not.toContain("booking_attendance");
  });

  it("keeps relationship state and internal helpers inaccessible to normal clients", () => {
    const sql = readMigration();

    expect(sql).toContain("alter table public.referral_relationships enable row level security");
    expect(sql).toContain("revoke all on public.referral_relationships from public, anon, authenticated, service_role");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function public.set_referral_relationships_updated_at() from public, anon, authenticated, service_role");
  });

  it("keeps direct code access and generation unavailable to clients while allowing only a player to read their own code", () => {
    const sql = readMigration();

    expect(sql).toContain("alter table public.referral_codes enable row level security");
    expect(sql).toContain("revoke all on public.referral_codes from public, anon, authenticated, service_role");
    expect(sql).toContain("create or replace function public.get_my_referral_code()");
    expect(sql).toContain("v_user_id uuid := auth.uid();");
    expect(sql).toContain("raise exception 'authentication required' using errcode = '42501'");
    expect(sql).toContain("where referral_code.user_id = v_user_id");
    expect(sql).toContain("revoke all on function public.get_my_referral_code() from public, anon, service_role");
    expect(sql).toContain("grant execute on function public.get_my_referral_code() to authenticated");
    expect(sql).toContain("revoke all on function public.ensure_referral_code(uuid, text) from public, anon, authenticated, service_role");
  });
});
