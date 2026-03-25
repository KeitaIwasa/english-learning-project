import { NextResponse } from "next/server";
import { verifyWorkerToken } from "@/lib/cloud-tasks";
import { createAdminSupabaseClient } from "@/lib/service";
import { runSpeechFixerProcess } from "@/lib/speech-fixer-process";

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
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
