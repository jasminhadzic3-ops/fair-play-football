import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    __dirname,
    "../../supabase/migrations/20260923120000_set_loyalty_completion_delay_one_hour.sql"
  ),
  "utf8"
).toLowerCase();

describe("loyalty one-hour settlement migration", () => {
  it("safely updates only the existing singleton from the historical delay", () => {
    expect(sql).toContain("from public.loyalty_config");
    expect(sql).toContain("if v_config_count <> 1 then");
    expect(sql).toContain("for update");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain("update public.loyalty_config as config");
    expect(sql).toContain("where config.id = true");
  });

  it("does not recreate or mutate loyalty rewards ledgers", () => {
    expect(sql).not.toContain("loyalty_booking_contributions");
    expect(sql).not.toContain("loyalty_reward_cycles");
    expect(sql).not.toContain("loyalty_progress_adjustments");
    expect(sql).not.toContain("wallet_transactions");
    expect(sql).not.toContain("reconcile_loyalty_rewards");
    expect(sql).not.toContain("alter table");
  });
});
