const defaultSupabaseUrl = "https://bpvbkndywnvfvxxzzaes.supabase.co";
const testSupabaseRef = "gtrpegnxhawmkbhyqedh";

export type E2ESupabaseMutationEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
};

export function canRunDatabaseMutationE2E() {
  return process.env.E2E_ALLOW_DB_MUTATION === "true";
}

export function requireDatabaseMutationE2EEnv(): E2ESupabaseMutationEnv {
  if (!canRunDatabaseMutationE2E()) {
    throw new Error(
      "DB-mutating E2E tests require E2E_ALLOW_DB_MUTATION=true."
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("DB-mutating E2E tests require NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!supabasePublishableKey) {
    throw new Error(
      "DB-mutating E2E tests require NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  if (!supabaseServiceRoleKey) {
    throw new Error("DB-mutating E2E tests require SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (supabaseUrl === defaultSupabaseUrl) {
    throw new Error(
      "DB-mutating E2E tests must not run against the production Supabase project."
    );
  }

  if (!supabaseUrl.includes(`${testSupabaseRef}.supabase.co`)) {
    throw new Error(
      `DB-mutating E2E tests require the TEST Supabase project (${testSupabaseRef}).`
    );
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
    supabaseServiceRoleKey,
  };
}
