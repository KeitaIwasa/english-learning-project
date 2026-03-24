import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data.user ?? null;
});
