import { createClient } from "npm:@supabase/supabase-js@2";
import { appEnv } from "./env.ts";

export function createUserClient(req: Request) {
  const authHeader = req.headers.get("Authorization");
  return createClient(appEnv.supabaseUrl(), appEnv.supabaseAnonKey(), {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {}
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function createServiceClient() {
  return createClient(appEnv.supabaseUrl(), appEnv.supabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
