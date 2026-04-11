import { createAdminSupabaseClient } from "@/lib/service";
import { enqueueWorkerTask } from "@/lib/cloud-tasks";
import { todayInJst } from "@/lib/date";

export type ReadingGenerationTriggerType = "manual" | "cron";
export type ReadingGenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export type ReadingGenerationJob = {
  id: string;
  user_id: string;
  target_date: string;
  trigger_type: ReadingGenerationTriggerType;
  status: ReadingGenerationJobStatus;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExecuteReadingGenerationParams = {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
  triggerType: ReadingGenerationTriggerType;
  force: boolean;
  profileId?: string;
};

type ExecuteReadingGenerationResult =
  | {
      ok: true;
      conflict: false;
      job: ReadingGenerationJob;
      payload: Record<string, unknown>;
      status: number;
    }
  | {
      ok: false;
      conflict: true;
      job: ReadingGenerationJob;
      error: string;
      status: number;
    }
  | {
      ok: false;
      conflict: false;
      job: ReadingGenerationJob;
      error: string;
      status: number;
    };

const ACTIVE_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export function resolveTargetDate(rawDate: unknown) {
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
    return rawDate.trim();
  }
  return todayInJst();
}

export async function markTimedOutActiveJobs(params: {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
}) {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - ACTIVE_JOB_TIMEOUT_MS).toISOString();

  const processingTimeout = await params.adminClient
    .from("reading_generation_jobs")
    .update({
      status: "failed",
      error_message: "Timed out after 15 minutes",
      completed_at: nowIso
    })
    .eq("user_id", params.userId)
    .eq("target_date", params.targetDate)
    .eq("status", "processing")
    .lt("started_at", cutoffIso);

  if (processingTimeout.error) {
    throw processingTimeout.error;
  }

  const queuedTimeout = await params.adminClient
    .from("reading_generation_jobs")
    .update({
      status: "failed",
      error_message: "Queue wait timed out after 15 minutes",
      completed_at: nowIso
    })
    .eq("user_id", params.userId)
    .eq("target_date", params.targetDate)
    .eq("status", "queued")
    .lt("created_at", cutoffIso);

  if (queuedTimeout.error) {
    throw queuedTimeout.error;
  }
}

export async function getLatestJobForDate(params: {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
}) {
  const { data, error } = await params.adminClient
    .from("reading_generation_jobs")
    .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
    .eq("user_id", params.userId)
    .eq("target_date", params.targetDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ReadingGenerationJob | null) ?? null;
}

async function getActiveJob(params: {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
}) {
  const { data, error } = await params.adminClient
    .from("reading_generation_jobs")
    .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
    .eq("user_id", params.userId)
    .eq("target_date", params.targetDate)
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ReadingGenerationJob | null) ?? null;
}

export async function executeReadingGeneration(params: ExecuteReadingGenerationParams): Promise<ExecuteReadingGenerationResult> {
  await markTimedOutActiveJobs({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate: params.targetDate
  });

  const activeJob = await getActiveJob({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate: params.targetDate
  });

  if (activeJob) {
    return {
      ok: false,
      conflict: true,
      job: activeJob,
      error: "すでに生成中です。",
      status: 409
    };
  }

  const queuedInsert = await params.adminClient
    .from("reading_generation_jobs")
    .insert({
      user_id: params.userId,
      target_date: params.targetDate,
      trigger_type: params.triggerType,
      status: "queued"
    })
    .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
    .single();

  if (queuedInsert.error) {
    if (queuedInsert.error.code === "23505") {
      const conflicted = await getActiveJob({
        adminClient: params.adminClient,
        userId: params.userId,
        targetDate: params.targetDate
      });
      if (conflicted) {
        return {
          ok: false,
          conflict: true,
          job: conflicted,
          error: "すでに生成中です。",
          status: 409
        };
      }
    }
    throw queuedInsert.error;
  }

  const queuedJob = queuedInsert.data as ReadingGenerationJob;

  try {
    await enqueueWorkerTask({
      kind: "reading",
      payload: {
        jobId: queuedJob.id,
        userId: params.userId,
        targetDate: params.targetDate,
        force: params.force,
        profileId: params.profileId
      }
    });
  } catch (error) {
    const failedUpdate = await params.adminClient
      .from("reading_generation_jobs")
      .update({
        status: "failed",
        error_message: String(error),
        completed_at: new Date().toISOString()
      })
      .eq("id", queuedJob.id)
      .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
      .single();

    if (failedUpdate.error) {
      throw failedUpdate.error;
    }

    return {
      ok: false,
      conflict: false,
      job: failedUpdate.data as ReadingGenerationJob,
      error: String(error),
      status: 500
    };
  }

  return {
    ok: true,
    conflict: false,
    job: queuedJob,
    payload: { queued: true },
    status: 202
  };
}
