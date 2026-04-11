import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/service";
import { enqueueWorkerTask } from "@/lib/cloud-tasks";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

export type LineDeliveryTriggerType = "auto" | "manual";
export type LineDeliveryJobStatus = "queued" | "processing" | "completed" | "failed";

export type LineDeliveryJob = {
  id: string;
  user_id: string;
  passage_id: string;
  target_date: string;
  trigger_type: LineDeliveryTriggerType;
  status: LineDeliveryJobStatus;
  retry_count: number;
  line_user_id: string;
  line_retry_key: string;
  line_request_id: string | null;
  payload_json: Record<string, unknown>;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type EnqueueLineDeliveryResult =
  | {
      ok: true;
      conflict: false;
      queued: boolean;
      reused: boolean;
      job: LineDeliveryJob;
      status: number;
    }
  | {
      ok: false;
      conflict: true;
      job: LineDeliveryJob;
      error: string;
      status: number;
    }
  | {
      ok: false;
      conflict: false;
      error: string;
      status: number;
      job?: LineDeliveryJob;
    };

const ACTIVE_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export async function markTimedOutLineDeliveryJobs(params: {
  adminClient: AppSupabaseClient;
  userId: string;
  targetDate: string;
}) {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - ACTIVE_JOB_TIMEOUT_MS).toISOString();

  const processingTimeout = await params.adminClient
    .from("line_delivery_jobs")
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
    .from("line_delivery_jobs")
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

export async function getLatestLineDeliveryJob(params: {
  adminClient: AppSupabaseClient;
  userId: string;
}) {
  const { data, error } = await params.adminClient
    .from("line_delivery_jobs")
    .select(
      "id, user_id, passage_id, target_date, trigger_type, status, retry_count, line_user_id, line_retry_key, line_request_id, payload_json, error_message, started_at, completed_at, created_at, updated_at"
    )
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as LineDeliveryJob | null) ?? null;
}

export async function getLatestReadingPassageForUser(params: {
  adminClient: AppSupabaseClient;
  userId: string;
}) {
  const { data, error } = await params.adminClient
    .from("reading_passages")
    .select("id, generated_for_date")
    .eq("user_id", params.userId)
    .order("generated_for_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getReadingPassageForDate(params: {
  adminClient: AppSupabaseClient;
  userId: string;
  targetDate: string;
}) {
  const { data, error } = await params.adminClient
    .from("reading_passages")
    .select("id, generated_for_date")
    .eq("user_id", params.userId)
    .eq("generated_for_date", params.targetDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function enqueueLineDelivery(params: {
  adminClient: AppSupabaseClient;
  userId: string;
  targetDate: string;
  passageId: string;
  triggerType: LineDeliveryTriggerType;
  allowResend: boolean;
}) {
  await markTimedOutLineDeliveryJobs({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate: params.targetDate
  });

  const { data: profile, error: profileError } = await params.adminClient
    .from("profiles")
    .select("line_user_id, line_push_enabled, line_link_status")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const lineUserId = String(profile?.line_user_id ?? "").trim();
  if (!lineUserId || profile?.line_link_status !== "linked") {
    return {
      ok: false,
      conflict: false,
      error: "LINE未連携です。",
      status: 409
    } satisfies EnqueueLineDeliveryResult;
  }

  if (params.triggerType === "auto" && profile?.line_push_enabled !== true) {
    return {
      ok: false,
      conflict: false,
      error: "LINE自動送信がOFFです。",
      status: 409
    } satisfies EnqueueLineDeliveryResult;
  }

  const { data: existing, error: existingError } = await params.adminClient
    .from("line_delivery_jobs")
    .select(
      "id, user_id, passage_id, target_date, trigger_type, status, retry_count, line_user_id, line_retry_key, line_request_id, payload_json, error_message, started_at, completed_at, created_at, updated_at"
    )
    .eq("user_id", params.userId)
    .eq("target_date", params.targetDate)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let job: LineDeliveryJob;
  const nowIso = new Date().toISOString();

  if (existing) {
    const current = existing as LineDeliveryJob;
    if (current.status === "queued" || current.status === "processing") {
      return {
        ok: false,
        conflict: true,
        error: "すでにLINE送信中です。",
        status: 409,
        job: current
      } satisfies EnqueueLineDeliveryResult;
    }

    if (!params.allowResend) {
      return {
        ok: true,
        conflict: false,
        queued: false,
        reused: true,
        status: 200,
        job: current
      } satisfies EnqueueLineDeliveryResult;
    }

    const updated = await params.adminClient
      .from("line_delivery_jobs")
      .update({
        passage_id: params.passageId,
        trigger_type: params.triggerType,
        status: "queued",
        retry_count: 0,
        line_user_id: lineUserId,
        line_retry_key: randomUUID(),
        line_request_id: null,
        payload_json: {
          requestedAt: nowIso,
          triggerType: params.triggerType
        },
        error_message: null,
        started_at: null,
        completed_at: null
      })
      .eq("id", current.id)
      .select(
        "id, user_id, passage_id, target_date, trigger_type, status, retry_count, line_user_id, line_retry_key, line_request_id, payload_json, error_message, started_at, completed_at, created_at, updated_at"
      )
      .single();

    if (updated.error) {
      throw updated.error;
    }
    job = updated.data as LineDeliveryJob;
  } else {
    const inserted = await params.adminClient
      .from("line_delivery_jobs")
      .insert({
        user_id: params.userId,
        passage_id: params.passageId,
        target_date: params.targetDate,
        trigger_type: params.triggerType,
        status: "queued",
        line_user_id: lineUserId,
        line_retry_key: randomUUID(),
        payload_json: {
          requestedAt: nowIso,
          triggerType: params.triggerType
        }
      })
      .select(
        "id, user_id, passage_id, target_date, trigger_type, status, retry_count, line_user_id, line_retry_key, line_request_id, payload_json, error_message, started_at, completed_at, created_at, updated_at"
      )
      .single();

    if (inserted.error) {
      throw inserted.error;
    }
    job = inserted.data as LineDeliveryJob;
  }

  try {
    await enqueueWorkerTask({
      kind: "line_delivery",
      payload: {
        jobId: job.id,
        userId: params.userId,
        targetDate: params.targetDate
      }
    });
  } catch (error) {
    const failedUpdate = await params.adminClient
      .from("line_delivery_jobs")
      .update({
        status: "failed",
        error_message: String(error),
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id)
      .select(
        "id, user_id, passage_id, target_date, trigger_type, status, retry_count, line_user_id, line_retry_key, line_request_id, payload_json, error_message, started_at, completed_at, created_at, updated_at"
      )
      .single();

    if (failedUpdate.error) {
      throw failedUpdate.error;
    }

    return {
      ok: false,
      conflict: false,
      error: String(error),
      status: 500,
      job: failedUpdate.data as LineDeliveryJob
    } satisfies EnqueueLineDeliveryResult;
  }

  return {
    ok: true,
    conflict: false,
    queued: true,
    reused: false,
    status: 202,
    job
  } satisfies EnqueueLineDeliveryResult;
}
