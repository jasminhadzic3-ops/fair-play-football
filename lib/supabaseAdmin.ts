import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bpvbkndywnvfvxxzzaes.supabase.co";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function assertSupabaseAdminConfigured() {
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server payment routes.");
  }
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || "missing-service-role-key", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
