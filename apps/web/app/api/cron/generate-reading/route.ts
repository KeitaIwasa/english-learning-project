import { NextResponse } from "next/server";
import { createAdminSupabaseClient, executeReadingGeneration, resolveTargetDate } from "@/app/api/reading/_jobs";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetDate = resolveTargetDate(body?.date);
    const force = body?.force === true;
    const profileId = typeof body?.profileId === "string" ? body.profileId : undefined;
    const userId = typeof body?.userId === "string" ? body.userId : "";

    const adminClient = createAdminSupabaseClient();

    let userIds: string[] = [];
    if (userId) {
      userIds = [userId];
    } else {
      const { data, error } = await adminClient.from("profiles").select("user_id");
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      userIds = (data ?? []).map((row) => String(row.user_id)).filter(Boolean);
    }

    if (userIds.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, targetDate, results: [] });
    }

    const results: Array<{
      userId: string;
      ok: boolean;
      status: number;
      jobId?: string;
      jobStatus?: string;
      error?: string;
      conflict?: boolean;
    }> = [];

    for (const targetUserId of userIds) {
      const result = await executeReadingGeneration({
        adminClient,
        userId: targetUserId,
        targetDate,
        triggerType: "cron",
        force,
        profileId
      });

      if (!result.ok) {
        results.push({
          userId: targetUserId,
          ok: false,
          status: result.status,
          jobId: result.job.id,
          jobStatus: result.job.status,
          error: result.error,
          conflict: result.conflict
        });
        continue;
      }

      results.push({
        userId: targetUserId,
        ok: true,
        status: result.status,
        jobId: result.job.id,
        jobStatus: result.job.status
      });
    }

    const failed = results.filter((item) => !item.ok && !item.conflict).length;
    const conflicts = results.filter((item) => item.conflict).length;

    return NextResponse.json(
      {
        ok: failed === 0,
        processed: results.length,
        failed,
        conflicts,
        targetDate,
        results
      },
      { status: failed === 0 ? 200 : 500 }
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
