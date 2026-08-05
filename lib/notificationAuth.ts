import "server-only";

import { assertSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getAuthenticatedNotificationUser(authHeader: string | null) {
  assertSupabaseAdminConfigured();

  const token = authHeader?.replace("Bearer ", "").trim();

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}
