import { createClient } from "@supabase/supabase-js";

const AUTH_LIST_PAGE_SIZE = 1000;

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

export type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

export async function listAllAuthUserIds(admin: AdminSupabaseClient): Promise<string[]> {
  const userIds = new Set<string>();
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_LIST_PAGE_SIZE
    });

    if (error) {
      throw error;
    }

    for (const user of data.users) {
      if (user.id) {
        userIds.add(user.id);
      }
    }

    if (!data.nextPage || data.users.length === 0) {
      break;
    }

    page = data.nextPage;
  }

  return [...userIds];
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
