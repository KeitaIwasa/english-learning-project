import { enqueueWorkerTask } from "@/lib/cloud-tasks";

const FOLLOWUP_DELAY_SECONDS = 30;

export async function enqueueSpeechFixerTask(params?: {
  limit?: number;
  trigger?: string;
  delaySeconds?: number;
}) {
  const limit = Math.max(1, Math.min(10, Number(params?.limit ?? 3)));
  return await enqueueWorkerTask({
    kind: "speech_fixer",
    payload: {
      limit,
      trigger: String(params?.trigger ?? "").trim() || "manual"
    },
    delaySeconds: Math.max(0, Number(params?.delaySeconds ?? 0))
  });
}

export async function enqueueSpeechFixerFollowup(params?: { limit?: number }) {
  return await enqueueSpeechFixerTask({
    limit: params?.limit,
    trigger: "followup",
    delaySeconds: FOLLOWUP_DELAY_SECONDS
  });
}
