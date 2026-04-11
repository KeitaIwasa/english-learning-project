import { createAdminSupabaseClient, type AdminSupabaseClient } from "@/lib/service";

export async function ensureProfileExists(params: {
  userId: string;
  adminClient?: AdminSupabaseClient;
}) {
  const userId = String(params.userId ?? "").trim();
  if (!userId) {
    return;
  }

  const admin = params.adminClient ?? createAdminSupabaseClient();
  const { error } = await admin.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id" });
  if (error) {
    throw error;
  }
}
