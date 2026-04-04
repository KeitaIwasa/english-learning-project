import { NextResponse } from "next/server";
import { verifyWorkerToken } from "@/lib/cloud-tasks";
import { createAdminSupabaseClient } from "@/lib/service";
import { runSpeechFixerProcess } from "@/lib/speech-fixer-process";
import { enqueueSpeechFixerFollowup } from "@/lib/speech-fixer-worker";

export async function POST(request: Request) {
  if (!verifyWorkerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(10, Number(body?.limit ?? 3)));

  try {
    const result = await runSpeechFixerProcess({
      serviceClient: createAdminSupabaseClient(),
      limit
    });

    let followupTaskName = "";
    if (result.needsFollowup) {
      followupTaskName = await enqueueSpeechFixerFollowup({ limit });
    }

    return NextResponse.json({
      ...result,
      followupQueued: Boolean(followupTaskName),
      followupTaskName
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
