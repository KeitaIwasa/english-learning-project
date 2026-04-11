import { NextResponse } from "next/server";
import { verifyWorkerToken } from "@/lib/cloud-tasks";
import { todayInJst } from "@/lib/date";
import { createAdminSupabaseClient, listAllAuthUserIds } from "@/lib/service";
import { computeLearningProfile } from "@/lib/learning/profile-builder";

type Payload = {
  userId?: string;
  date?: string;
  lookbackDays?: number;
};

export async function POST(request: Request) {
  if (!verifyWorkerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Payload;
  const targetDate = typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
    ? payload.date
    : todayInJst();
  const lookbackDays = Number.isFinite(Number(payload.lookbackDays)) ? Number(payload.lookbackDays) : 14;

  const admin = createAdminSupabaseClient();
  const userIds = payload.userId
    ? [payload.userId]
    : await listUserIds(admin);

  const results: Array<{ userId: string; ok: boolean; profileId?: string; error?: string }> = [];

  for (const userId of userIds) {
    try {
      const profile = await computeLearningProfile({
        serviceClient: admin,
        userId,
        lookbackDays,
        targetDate
      });

      const { data: upserted, error: upsertError } = await admin
        .from("learning_profiles")
        .upsert(
          {
            user_id: userId,
            target_date: targetDate,
            lookback_days: lookbackDays,
            review_targets_json: profile.reviewTargets,
            grammar_targets_json: profile.grammarTargets,
            new_candidates_json: profile.newCandidates
          },
          { onConflict: "user_id,target_date" }
        )
        .select("id")
        .single();

      if (upsertError) {
        throw upsertError;
      }

      results.push({ userId, ok: true, profileId: upserted.id });
    } catch (error) {
      results.push({ userId, ok: false, error: String(error) });
    }
  }

  const failed = results.filter((item) => !item.ok).length;
  return NextResponse.json({ ok: failed === 0, targetDate, lookbackDays, processed: results.length, failed, results }, { status: failed === 0 ? 200 : 500 });
}

async function listUserIds(admin: ReturnType<typeof createAdminSupabaseClient>) {
  return await listAllAuthUserIds(admin);
}
