import type { User } from "@supabase/supabase-js";
import { assertSupabaseAdminConfigured, supabaseAdmin } from "./supabaseAdmin";

export async function getAuthenticatedAdminUser(authHeader: string | null): Promise<User | null> {
  assertSupabaseAdminConfigured();

  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  const isAdmin = await isAdminUser(data.user.id);

  return isAdmin ? data.user : null;
}

export async function isAdminUser(userId: string): Promise<boolean> {
  assertSupabaseAdminConfigured();

  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
