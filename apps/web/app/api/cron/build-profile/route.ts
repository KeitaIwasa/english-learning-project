import { NextResponse } from "next/server";
import { todayInJst } from "@/lib/date";
import { createAdminSupabaseClient, listAllAuthUserIds } from "@/lib/service";
import { enqueueWorkerTask } from "@/lib/cloud-tasks";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetDate = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayInJst();
    const lookbackDays = Number.isFinite(Number(body?.lookbackDays)) ? Number(body.lookbackDays) : 14;
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";

    const admin = createAdminSupabaseClient();
    const userIds = userId ? [userId] : await listUserIds(admin);
    const taskNames: string[] = [];

    for (const targetUserId of userIds) {
      const taskName = await enqueueWorkerTask({
        kind: "profile",
        payload: {
          userId: targetUserId,
          date: targetDate,
          lookbackDays
        }
      });
      taskNames.push(taskName);
    }

    return NextResponse.json({
      ok: true,
      queued: userIds.length,
      targetDate,
      lookbackDays,
      taskNames
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function listUserIds(admin: ReturnType<typeof createAdminSupabaseClient>) {
  return await listAllAuthUserIds(admin);
}
