import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readSql(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8").toLowerCase();
}

function extractSection(sql: string, startMarker: string, endMarker: string) {
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return sql.slice(start, end);
}

describe("booking RLS policies", () => {
  it("keeps client-side booking writes disabled while preserving reads", () => {
    const rlsSql = readSql("supabase/rls_policies.sql");
    const baseSchemaSql = readSql("supabase/base_schema.sql");
    const bookingPolicySql = extractSection(
      rlsSql,
      "-- bookings: store the authenticated owner on every booking.",
      "-- games: public read-only from client apps."
    );

    expect(bookingPolicySql).toContain("grant select on public.bookings to anon, authenticated");
    expect(bookingPolicySql).toContain("revoke insert, update, delete on public.bookings from anon, authenticated");
    expect(bookingPolicySql).not.toMatch(/create\s+policy\s+"bookings are insertable by owner"/);
    expect(bookingPolicySql).not.toMatch(/create\s+policy\s+"bookings are deletable by owner"/);
    expect(bookingPolicySql).not.toMatch(/for\s+insert\s+to\s+authenticated/);
    expect(bookingPolicySql).not.toMatch(/for\s+delete\s+to\s+authenticated/);

    expect(baseSchemaSql).toContain("grant select on table public.bookings to anon");
    expect(baseSchemaSql).toContain("grant select on table public.bookings to authenticated");
    expect(baseSchemaSql).not.toContain("grant all on table public.bookings to authenticated");
    expect(baseSchemaSql).not.toContain("grant all on sequence public.bookings_id_seq to authenticated");
  });
});
