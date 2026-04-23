import { ReadingLineCard } from "@/components/reading-line-card";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/current-user";

type LineProfileRow = {
  line_push_enabled: boolean;
  line_user_id: string | null;
  line_link_status: "unlinked" | "pending" | "linked";
  line_linked_at: string | null;
  line_last_delivery_at: string | null;
};

type ActiveLineCodeRow = {
  code: string;
  expires_at: string;
};

type LineDeliveryJobRow = {
  status: "queued" | "processing" | "completed" | "failed";
  target_date: string;
  error_message: string | null;
  completed_at: string | null;
};

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <section className="panel">
        <h2>設定</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  const [profileResult, activeCodeResult, latestJobResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("line_push_enabled, line_user_id, line_link_status, line_linked_at, line_last_delivery_at")
      .maybeSingle(),
    supabase
      .from("line_link_codes")
      .select("code, expires_at")
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("line_delivery_jobs")
      .select("status, target_date, error_message, completed_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const lineProfile =
    (profileResult.data as LineProfileRow | null) ?? {
      line_push_enabled: false,
      line_user_id: null,
      line_link_status: "unlinked",
      line_linked_at: null,
      line_last_delivery_at: null
    };
  const activeCode = (activeCodeResult.data as ActiveLineCodeRow | null) ?? null;
  const latestLineJob = (latestJobResult.data as LineDeliveryJobRow | null) ?? null;

  return (
    <div className="grid">
      <section className="panel">
        <h2>設定</h2>
        <p className="muted">アカウント連携とLINE自動送信を管理できます。</p>
      </section>

      <ReadingLineCard
        linked={Boolean(lineProfile.line_user_id)}
        pushEnabled={lineProfile.line_push_enabled}
        linkStatus={lineProfile.line_link_status}
        linkedAt={lineProfile.line_linked_at}
        lastDeliveryAt={lineProfile.line_last_delivery_at}
        activeCode={activeCode ? { code: activeCode.code, expiresAt: activeCode.expires_at } : null}
        latestJob={
          latestLineJob
            ? {
                status: latestLineJob.status,
                targetDate: latestLineJob.target_date,
                error: latestLineJob.error_message,
                completedAt: latestLineJob.completed_at
              }
            : null
        }
      />
    </div>
  );
}
