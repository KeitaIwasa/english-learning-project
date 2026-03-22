import { corsHeaders } from "../_shared/cors.ts";
import { appEnv } from "../_shared/env.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  deleteFromGcs,
  extractTranscriptFromSpeechResponse,
  getGoogleAccessToken,
  getSpeechOperation,
  startSpeechLongRunningRecognize
} from "../_shared/google-cloud.ts";
import { buildSpeechFixCorrections } from "../_shared/speech-fixer.ts";

type SpeechFixJobRow = {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  status: "uploaded" | "queued" | "processing" | "completed" | "failed";
  gcs_bucket: string | null;
  gcs_object_name: string | null;
  gcs_upload_completed_at: string | null;
  transcript_full: string | null;
  corrections_json: unknown;
  stats_json: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type JobStats = {
  sttOperationName?: string;
  gcsBucket?: string;
  gcsObjectName?: string;
  gcsUri?: string;
  [key: string]: unknown;
};

const MAX_BATCH_DEFAULT = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!isAuthorizedServiceRole(authHeader)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const serviceClient = createServiceClient();
    const payload = await readBody(req);
    const limit = Math.max(1, Math.min(10, Number(payload?.limit ?? MAX_BATCH_DEFAULT)));

    const queuedResult = await runQueuedJobs(serviceClient, limit);
    const processingResult = await runProcessingJobs(serviceClient, limit);

    return json({
      ok: true,
      processing: processingResult,
      queued: queuedResult
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

async function runProcessingJobs(serviceClient: ReturnType<typeof createServiceClient>, limit: number) {
  const { data, error } = await serviceClient
    .from("speech_fix_jobs")
    .select("*")
    .eq("status", "processing")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  let completed = 0;
  let pending = 0;
  let failed = 0;
  for (const job of (data ?? []) as SpeechFixJobRow[]) {
    const result = await finalizeProcessingJob(serviceClient, job);
    if (result === "completed") {
      completed += 1;
    } else if (result === "pending") {
      pending += 1;
    } else {
      failed += 1;
    }
  }
  return { total: (data ?? []).length, completed, pending, failed };
}

async function runQueuedJobs(serviceClient: ReturnType<typeof createServiceClient>, limit: number) {
  const { data, error } = await serviceClient
    .from("speech_fix_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  let started = 0;
  let failed = 0;
  for (const job of (data ?? []) as SpeechFixJobRow[]) {
    const ok = await startQueuedJob(serviceClient, job);
    if (ok) {
      started += 1;
    } else {
      failed += 1;
    }
  }
  return { total: (data ?? []).length, started, failed };
}

async function startQueuedJob(serviceClient: ReturnType<typeof createServiceClient>, job: SpeechFixJobRow) {
  const currentStats = getStats(job);

  try {
    const processingClaimedAt = new Date().toISOString();
    const claim = await serviceClient
      .from("speech_fix_jobs")
      .update({
        status: "processing",
        error_message: null
      })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (claim.error || !claim.data) {
      return false;
    }

    const gcsBucket = normalizeGcsField(job.gcs_bucket);
    const gcsObjectName = normalizeGcsField(job.gcs_object_name);
    if (!gcsBucket || !gcsObjectName) {
      await failJob(serviceClient, job, "gcs bucket/object missing");
      return false;
    }

    const googleAccessToken = await getGoogleAccessToken({
      serviceAccountJson: appEnv.googleApplicationCredentialsJson(),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    const gcsUri = `gs://${gcsBucket}/${gcsObjectName}`;

    const operationName = await startSpeechLongRunningRecognize({
      accessToken: googleAccessToken,
      languageCode: "en-US",
      gcsUri
    });

    const queuedAt = asIsoString(currentStats.queuedAt) ?? job.updated_at ?? job.created_at;
    const queueWaitMs = diffMs(queuedAt, processingClaimedAt);
    const sttStartedAt = new Date().toISOString();
    const nextStats = {
      ...currentStats,
      queuedAt,
      processingClaimedAt,
      queueWaitMs,
      gcsBucket,
      gcsObjectName,
      gcsUri,
      sttOperationName: operationName,
      sttStartedAt
    };

    const { error: updateError } = await serviceClient
      .from("speech_fix_jobs")
      .update({
        status: "processing",
        stats_json: nextStats
      })
      .eq("id", job.id);

    if (updateError) {
      throw updateError;
    }

    return true;
  } catch (error) {
    await failJob(serviceClient, job, String(error));
    return false;
  }
}

async function finalizeProcessingJob(serviceClient: ReturnType<typeof createServiceClient>, job: SpeechFixJobRow) {
  const stats = getStats(job);
  const operationName = typeof stats.sttOperationName === "string" ? stats.sttOperationName : "";
  if (!operationName) {
    await failJob(serviceClient, job, "STT operation name missing");
    return "failed" as const;
  }

  try {
    const accessToken = await getGoogleAccessToken({
      serviceAccountJson: appEnv.googleApplicationCredentialsJson(),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const operation = await getSpeechOperation({
      accessToken,
      operationName
    });

    if (!operation.done) {
      return "pending" as const;
    }

    if (operation.error?.message) {
      await failJob(serviceClient, job, `Speech-to-Text failed: ${operation.error.message}`);
      return "failed" as const;
    }

    const transcript = extractTranscriptFromSpeechResponse(operation.response ?? {}).trim();
    if (!transcript) {
      await failJob(serviceClient, job, "Speech-to-Text returned empty transcript");
      return "failed" as const;
    }

    const correctionStartedAt = new Date().toISOString();
    const corrections = await buildSpeechFixCorrections(transcript);
    const correctionCompletedAt = new Date().toISOString();
    const sttCompletedAt = correctionStartedAt;
    const sttMs = diffMs(asIsoString(stats.sttStartedAt), sttCompletedAt);
    const correctionMs = diffMs(correctionStartedAt, correctionCompletedAt);
    const totalMs = diffMs(asIsoString(stats.queuedAt) ?? job.created_at, correctionCompletedAt);
    const nextStats = {
      ...stats,
      transcriptLength: transcript.length,
      correctionCount: corrections.length,
      sttCompletedAt,
      correctionStartedAt,
      correctionCompletedAt,
      sttMs,
      correctionMs,
      totalMs
    };

    const { error: updateError } = await serviceClient
      .from("speech_fix_jobs")
      .update({
        status: "completed",
        transcript_full: transcript,
        corrections_json: corrections,
        stats_json: nextStats,
        error_message: null,
        completed_at: correctionCompletedAt
      })
      .eq("id", job.id);

    if (updateError) {
      throw updateError;
    }

    await cleanupTempAudio(serviceClient, {
      ...job,
      stats_json: nextStats
    });

    return "completed" as const;
  } catch (error) {
    await failJob(serviceClient, job, String(error));
    return "failed" as const;
  }
}

async function failJob(serviceClient: ReturnType<typeof createServiceClient>, job: SpeechFixJobRow, reason: string) {
  const message = reason.slice(0, 1800);
  await serviceClient
    .from("speech_fix_jobs")
    .update({
      status: "failed",
      error_message: message
    })
    .eq("id", job.id);
  await cleanupTempAudio(serviceClient, job);
}

async function cleanupTempAudio(serviceClient: ReturnType<typeof createServiceClient>, job: SpeechFixJobRow) {
  const stats = getStats(job);
  const gcsBucket = normalizeGcsField(job.gcs_bucket || (typeof stats.gcsBucket === "string" ? stats.gcsBucket : ""));
  const gcsObjectName = normalizeGcsField(job.gcs_object_name || (typeof stats.gcsObjectName === "string" ? stats.gcsObjectName : ""));

  if (gcsBucket && gcsObjectName) {
    try {
      const accessToken = await getGoogleAccessToken({
        serviceAccountJson: appEnv.googleApplicationCredentialsJson(),
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
      });
      await deleteFromGcs({
        accessToken,
        bucket: gcsBucket,
        objectName: gcsObjectName
      });
    } catch (error) {
      console.error(`[speech-fixer] failed to remove gcs temp file: ${String(error)}`);
    }
  }
}

function getStats(job: SpeechFixJobRow): JobStats {
  if (!job.stats_json || typeof job.stats_json !== "object" || Array.isArray(job.stats_json)) {
    return {};
  }
  return job.stats_json as JobStats;
}

function asIsoString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function diffMs(start: string | null, end: string | null): number | null {
  if (!start || !end) {
    return null;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function normalizeGcsField(value: unknown): string {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (req.method !== "POST") {
    return null;
  }
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function isAuthorizedServiceRole(token: string): boolean {
  if (!token) {
    return false;
  }

  const configured = appEnv.supabaseServiceRoleKey();
  if (token === configured) {
    return true;
  }

  const payload = parseJwtPayload(token);
  if (!payload || payload.role !== "service_role") {
    return false;
  }

  const expectedRef = extractProjectRef(appEnv.supabaseUrl());
  if (!expectedRef) {
    return false;
  }
  return payload.ref === expectedRef;
}

function parseJwtPayload(token: string): { role?: string; ref?: string } | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as { role?: string; ref?: string };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractProjectRef(supabaseUrl: string): string {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.split(".")[0] ?? "";
  } catch {
    return "";
  }
}
