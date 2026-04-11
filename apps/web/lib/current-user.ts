import "server-only";

import { cache } from "react";
import { ensureProfileExists } from "@/lib/profiles";
import { createAdminSupabaseClient } from "@/lib/service";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  if (data.user?.id) {
    try {
      await ensureProfileExists({
        userId: data.user.id,
        adminClient: createAdminSupabaseClient()
      });
    } catch (profileError) {
      console.error("[current-user] failed to ensure profile", profileError);
    }
  }
  return data.user ?? null;
});
