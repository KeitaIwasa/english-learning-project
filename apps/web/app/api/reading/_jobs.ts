import { createClient } from "@supabase/supabase-js";
import { getServiceEnv } from "@/lib/service";

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

const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export function createAdminSupabaseClient() {
  const { supabaseUrl, serviceRoleKey } = getServiceEnv();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function resolveTargetDate(rawDate: unknown) {
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
    return rawDate.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

export async function markTimedOutProcessingJobs(params: {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
}) {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString();

  const { error } = await params.adminClient
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

  if (error) {
    throw error;
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
  await markTimedOutProcessingJobs({
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

  const processingUpdate = await params.adminClient
    .from("reading_generation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      error_message: null
    })
    .eq("id", queuedJob.id)
    .eq("status", "queued")
    .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
    .maybeSingle();

  if (processingUpdate.error) {
    throw processingUpdate.error;
  }

  if (!processingUpdate.data) {
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

    throw new Error("Failed to transition reading_generation_jobs to processing");
  }

  const processingJob = processingUpdate.data as ReadingGenerationJob;

  const upstream = await invokeReadingGenerateDaily({
    userId: params.userId,
    targetDate: params.targetDate,
    force: params.force,
    profileId: params.profileId
  });

  if (!upstream.ok) {
    const failedUpdate = await params.adminClient
      .from("reading_generation_jobs")
      .update({
        status: "failed",
        error_message: upstream.error,
        completed_at: new Date().toISOString()
      })
      .eq("id", processingJob.id)
      .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
      .single();

    if (failedUpdate.error) {
      throw failedUpdate.error;
    }

    return {
      ok: false,
      conflict: false,
      job: failedUpdate.data as ReadingGenerationJob,
      error: upstream.error,
      status: upstream.status
    };
  }

  const completedUpdate = await params.adminClient
    .from("reading_generation_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error_message: null
    })
    .eq("id", processingJob.id)
    .select("id, user_id, target_date, trigger_type, status, error_message, started_at, completed_at, created_at, updated_at")
    .single();

  if (completedUpdate.error) {
    throw completedUpdate.error;
  }

  return {
    ok: true,
    conflict: false,
    job: completedUpdate.data as ReadingGenerationJob,
    payload: upstream.payload,
    status: upstream.status
  };
}

async function invokeReadingGenerateDaily(params: {
  userId: string;
  targetDate: string;
  force: boolean;
  profileId?: string;
}) {
  const { supabaseUrl, serviceRoleKey } = getServiceEnv();

  const response = await fetch(`${supabaseUrl}/functions/v1/reading-generate-daily`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey
    },
    body: JSON.stringify({
      userId: params.userId,
      force: params.force,
      date: params.targetDate,
      profileId: params.profileId
    })
  });

  const raw = await response.text();
  const payload = parseMaybeJson(raw);
  const payloadError = typeof payload?.error === "string" ? payload.error : "";

  if (!response.ok || payloadError) {
    const fallbackError = raw.trim() || `reading-generate-daily failed: ${response.status}`;
    return {
      ok: false as const,
      status: response.status >= 400 ? response.status : 500,
      error: payloadError || fallbackError
    };
  }

  return {
    ok: true as const,
    status: response.status,
    payload
  };
}

function parseMaybeJson(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}
