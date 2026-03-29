import { NextResponse } from "next/server";
import { enqueueWorkerTask } from "@/lib/cloud-tasks";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(10, Number(body?.limit ?? 3)));
    const taskName = await enqueueWorkerTask({
      kind: "speech_fixer",
      payload: { limit, trigger: "cron" }
    });
    return NextResponse.json({ ok: true, queued: true, taskName, limit });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
