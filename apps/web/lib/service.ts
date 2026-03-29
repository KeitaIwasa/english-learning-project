import { createClient } from "@supabase/supabase-js";

export function getServiceEnv() {
  const supabaseUrl = normalizeEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = normalizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return { supabaseUrl, serviceRoleKey };
}

export function createAdminSupabaseClient() {
  const { supabaseUrl, serviceRoleKey } = getServiceEnv();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function resolveUserIdFromAccessToken(accessToken: string): Promise<string | null> {
  const token = normalizeEnv(accessToken);
  if (!token) {
    return null;
  }
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user.id;
}

function normalizeEnv(value: string | undefined) {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}
