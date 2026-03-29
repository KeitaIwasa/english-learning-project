import { appEnv } from "@/lib/app-env";
import {
  deleteFromGcs,
  extractTranscriptFromSpeechBatchResponse,
  getGoogleAccessToken,
  getGoogleProjectIdFromServiceAccountJson,
  getSpeechBatchOperation,
  parseGoogleServiceAccount,
  startSpeechBatchRecognize
} from "@/lib/google-cloud";
import { buildSpeechFixCorrections } from "@/lib/speech-fixer";
import { createAdminSupabaseClient } from "@/lib/service";

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
const MIN_TRANSCRIPT_LENGTH_FOR_LARGE_FILE = 80;
const LARGE_FILE_BYTES = 2_000_000;

export async function runSpeechFixerProcess(params: {
  serviceClient: ReturnType<typeof createAdminSupabaseClient>;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(10, Number(params.limit ?? MAX_BATCH_DEFAULT)));
  const queuedResult = await runQueuedJobs(params.serviceClient, limit);
  const processingResult = await runProcessingJobs(params.serviceClient, limit);

  return {
    ok: true,
    processing: processingResult,
    queued: queuedResult
  };
}

async function runProcessingJobs(serviceClient: ReturnType<typeof createAdminSupabaseClient>, limit: number) {
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

async function runQueuedJobs(serviceClient: ReturnType<typeof createAdminSupabaseClient>, limit: number) {
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

async function startQueuedJob(serviceClient: ReturnType<typeof createAdminSupabaseClient>, job: SpeechFixJobRow) {
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

    const serviceAccount = parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson());
    const googleAccessToken = await getGoogleAccessToken({
      serviceAccount,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const projectId = getGoogleProjectIdFromServiceAccountJson(appEnv.googleApplicationCredentialsJson());
    const sttLocation = appEnv.googleSpeechV2Location();
    const sttModel = appEnv.googleSpeechModel();

    const gcsUri = `gs://${gcsBucket}/${gcsObjectName}`;

    const operationName = await startSpeechBatchRecognize({
      accessToken: googleAccessToken,
      projectId,
      location: sttLocation,
      languageCode: "en-US",
      model: sttModel,
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
      sttApiVersion: "v2",
      sttLocation,
      sttModel,
      sttProjectId: projectId,
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

async function finalizeProcessingJob(serviceClient: ReturnType<typeof createAdminSupabaseClient>, job: SpeechFixJobRow) {
  const stats = getStats(job);
  const operationName = typeof stats.sttOperationName === "string" ? stats.sttOperationName : "";
  if (!operationName) {
    await failJob(serviceClient, job, "STT operation name missing");
    return "failed" as const;
  }

  try {
    const sttLocation = typeof stats.sttLocation === "string" ? stats.sttLocation : appEnv.googleSpeechV2Location();
    const gcsUri = typeof stats.gcsUri === "string" ? stats.gcsUri : null;
    const accessToken = await getGoogleAccessToken({
      serviceAccount: parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson()),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const operation = await getSpeechBatchOperation({
      accessToken,
      location: sttLocation,
      operationName
    });

    if (!operation.done) {
      return "pending" as const;
    }

    if (operation.error?.message) {
      const failedAt = new Date().toISOString();
      await failJob(serviceClient, job, `Speech-to-Text failed: ${operation.error.message}`, {
        ...stats,
        sttCompletedAt: failedAt,
        sttError: operation.error.message
      });
      return "failed" as const;
    }

    const transcriptResult = extractTranscriptFromSpeechBatchResponse({
      response: operation.response ?? {},
      gcsUri: gcsUri ?? undefined
    });
    const transcript = transcriptResult.transcript.trim();
    if (!transcript) {
      await failJob(serviceClient, job, "Speech-to-Text returned empty transcript", {
        ...stats,
        sttTranscriptLength: 0,
        sttResultCount: transcriptResult.totalResultCount,
        sttNonEmptyResultCount: transcriptResult.nonEmptyResultCount,
        sttEmptyResultCount: transcriptResult.emptyResultCount
      });
      return "failed" as const;
    }

    if (isLowQualityTranscript(job, transcript, transcriptResult)) {
      await failJob(serviceClient, job, "Speech-to-Text transcript appears low quality", {
        ...stats,
        sttTranscriptLength: transcript.length,
        sttResultCount: transcriptResult.totalResultCount,
        sttNonEmptyResultCount: transcriptResult.nonEmptyResultCount,
        sttEmptyResultCount: transcriptResult.emptyResultCount
      });
      return "failed" as const;
    }
    const correctionStartedAt = new Date().toISOString();
    const corrections = await buildSpeechFixCorrections({
      transcript,
      transcriptTurns: transcriptResult.turns
    });
    const correctionCompletedAt = new Date().toISOString();
    const sttCompletedAt = correctionStartedAt;
    const sttMs = diffMs(asIsoString(stats.sttStartedAt), sttCompletedAt);
    const correctionMs = diffMs(correctionStartedAt, correctionCompletedAt);
    const totalMs = diffMs(asIsoString(stats.queuedAt) ?? job.created_at, correctionCompletedAt);
    const nextStats = {
      ...stats,
      sttTranscriptLength: transcript.length,
      sttResultCount: transcriptResult.totalResultCount,
      sttNonEmptyResultCount: transcriptResult.nonEmptyResultCount,
      sttEmptyResultCount: transcriptResult.emptyResultCount,
      sttDetectedSpeakerCount: transcriptResult.detectedSpeakerCount,
      transcriptTurns: transcriptResult.turns,
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
    await failJob(serviceClient, job, String(error), getStats(job));
    return "failed" as const;
  }
}

async function failJob(
  serviceClient: ReturnType<typeof createAdminSupabaseClient>,
  job: SpeechFixJobRow,
  reason: string,
  nextStats?: JobStats
) {
  const message = reason.slice(0, 1800);
  const updates: Record<string, unknown> = {
    status: "failed",
    error_message: message
  };
  if (nextStats) {
    updates.stats_json = nextStats;
  }
  await serviceClient
    .from("speech_fix_jobs")
    .update(updates)
    .eq("id", job.id);
  await cleanupTempAudio(serviceClient, nextStats ? { ...job, stats_json: nextStats } : job);
}

async function cleanupTempAudio(_serviceClient: ReturnType<typeof createAdminSupabaseClient>, job: SpeechFixJobRow) {
  const stats = getStats(job);
  const gcsBucket = normalizeGcsField(job.gcs_bucket || (typeof stats.gcsBucket === "string" ? stats.gcsBucket : ""));
  const gcsObjectName = normalizeGcsField(job.gcs_object_name || (typeof stats.gcsObjectName === "string" ? stats.gcsObjectName : ""));

  if (gcsBucket && gcsObjectName) {
    try {
      const accessToken = await getGoogleAccessToken({
        serviceAccount: parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson()),
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

function isLowQualityTranscript(
  job: SpeechFixJobRow,
  transcript: string,
  sttResult: {
    totalResultCount: number;
    nonEmptyResultCount: number;
  }
) {
  if (sttResult.nonEmptyResultCount <= 0) {
    return true;
  }
  if (job.file_size >= LARGE_FILE_BYTES && transcript.length < MIN_TRANSCRIPT_LENGTH_FOR_LARGE_FILE) {
    return true;
  }
  if (sttResult.totalResultCount >= 4 && sttResult.nonEmptyResultCount <= 1 && transcript.length < 120) {
    return true;
  }
  return false;
}

function normalizeGcsField(value: unknown): string {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}
