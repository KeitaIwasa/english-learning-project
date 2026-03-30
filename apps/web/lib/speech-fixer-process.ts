import { appEnv } from "@/lib/app-env";
import { ensureFfmpegAvailable, splitAudioBufferIntoChunks } from "@/lib/audio-chunking";
import {
  downloadFromGcs,
  deleteFromGcs,
  extractTranscriptFromSpeechBatchResponse,
  getGoogleAccessToken,
  getGoogleProjectIdFromServiceAccountJson,
  getSpeechBatchOperation,
  parseGoogleServiceAccount,
  type SpeechDiarizedTurn,
  startSpeechBatchRecognize,
  uploadToGcs
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
  sttChunks?: SttChunk[];
  [key: string]: unknown;
};

type SttChunk = {
  index: number;
  gcsObjectName: string;
  gcsUri: string;
  operationName: string;
  attemptCount: number;
  status: "pending" | "completed" | "failed";
  transcript?: string;
  totalResultCount?: number;
  nonEmptyResultCount?: number;
  emptyResultCount?: number;
  transcriptTurns?: SpeechDiarizedTurn[];
  detectedSpeakerCount?: number;
  errorMessage?: string;
};

const MAX_BATCH_DEFAULT = 3;
const STT_CHUNK_DURATION_SEC = 15 * 60;
const STT_CHUNK_PARALLELISM = 4;
const STT_CHUNK_MAX_ATTEMPTS = 2;
const STT_STARTUP_GRACE_MS = 5 * 60 * 1000;
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
    const queuedAt = asIsoString(currentStats.queuedAt) ?? job.updated_at ?? job.created_at;
    const claim = await serviceClient
      .from("speech_fix_jobs")
      .update({
        status: "processing",
        error_message: null,
        stats_json: {
          ...currentStats,
          queuedAt,
          processingClaimedAt,
          sttInitState: "starting"
        }
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
    const chunkPlan = await createSttChunks({
      accessToken: googleAccessToken,
      projectId,
      location: sttLocation,
      model: sttModel,
      gcsBucket,
      gcsObjectName,
      gcsUri,
      fileName: job.file_name
    });

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
      sttOperationName: chunkPlan.chunks[0]?.operationName ?? "",
      sttChunks: chunkPlan.chunks,
      sttApiVersion: "v2",
      sttLocation,
      sttModel,
      sttProjectId: projectId,
      chunkingEnabled: chunkPlan.chunkingEnabled,
      chunkDurationSec: chunkPlan.chunkDurationSec,
      sourceDurationSec: chunkPlan.sourceDurationSec,
      chunkTotal: chunkPlan.chunks.length,
      sttStartedAt,
      sttInitState: "ready"
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
  const sttChunks = getSttChunks(job, stats);
  if (sttChunks.length === 0) {
    const initState = typeof stats.sttInitState === "string" ? stats.sttInitState : "";
    const claimedAt = asIsoString(stats.processingClaimedAt);
    const claimedRecently =
      claimedAt !== null && diffMs(claimedAt, new Date().toISOString()) !== null
        ? (diffMs(claimedAt, new Date().toISOString()) ?? 0) < STT_STARTUP_GRACE_MS
        : false;
    if (initState === "starting" && claimedRecently) {
      return "pending" as const;
    }
    await failJob(serviceClient, job, "STT operation name missing");
    return "failed" as const;
  }

  try {
    const sttLocation = typeof stats.sttLocation === "string" ? stats.sttLocation : appEnv.googleSpeechV2Location();
    const sttModel = typeof stats.sttModel === "string" ? stats.sttModel : appEnv.googleSpeechModel();
    const sttProjectId =
      typeof stats.sttProjectId === "string" && stats.sttProjectId.trim().length > 0
        ? stats.sttProjectId
        : getGoogleProjectIdFromServiceAccountJson(appEnv.googleApplicationCredentialsJson());
    const gcsUri = typeof stats.gcsUri === "string" ? stats.gcsUri : null;
    if (!gcsUri) {
      await failJob(serviceClient, job, "GCS URI missing for STT");
      return "failed" as const;
    }
    const accessToken = await getGoogleAccessToken({
      serviceAccount: parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson()),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const updatedChunks = await mapWithConcurrency<SttChunk, SttChunk>(sttChunks, STT_CHUNK_PARALLELISM, async (chunk) =>
      await refreshSttChunk({
        accessToken,
        projectId: sttProjectId,
        location: sttLocation,
        model: sttModel,
        chunk
      })
    );
    const chunkStats = summarizeChunkStates(updatedChunks);
    const nextStats = {
      ...stats,
      sttChunks: updatedChunks,
      chunkTotal: updatedChunks.length,
      chunkSucceeded: chunkStats.succeeded,
      chunkFailed: chunkStats.failed,
      partialTranscript: chunkStats.failed > 0,
      chunkFailures: updatedChunks
        .filter((chunk) => chunk.status === "failed" && String(chunk.errorMessage ?? "").trim().length > 0)
        .map((chunk) => ({
          index: chunk.index,
          errorMessage: chunk.errorMessage ?? ""
        })),
      sttRetryCountByChunk: Object.fromEntries(updatedChunks.map((chunk) => [String(chunk.index), chunk.attemptCount]))
    };

    if (chunkStats.pending > 0) {
      const { error: updateError } = await serviceClient
        .from("speech_fix_jobs")
        .update({
          status: "processing",
          stats_json: nextStats,
          error_message: null
        })
        .eq("id", job.id);
      if (updateError) {
        throw updateError;
      }
      return "pending" as const;
    }

    const transcriptResult = mergeChunkTranscripts(updatedChunks);
    if (!transcriptResult.transcript.trim()) {
      await failJob(serviceClient, job, "Speech-to-Text returned empty transcript", {
        ...nextStats,
        sttCompletedAt: new Date().toISOString(),
        sttError: "all chunks failed"
      });
      return "failed" as const;
    }

    return await completeJobWithTranscript(serviceClient, job, nextStats, transcriptResult);
  } catch (error) {
    await failJob(serviceClient, job, String(error), getStats(job));
    return "failed" as const;
  }
}

async function createSttChunks(params: {
  accessToken: string;
  projectId: string;
  location: string;
  model: string;
  gcsBucket: string;
  gcsObjectName: string;
  gcsUri: string;
  fileName: string;
}) {
  await ensureFfmpegAvailable();

  const sourceBuffer = await downloadFromGcs({
    accessToken: params.accessToken,
    bucket: params.gcsBucket,
    objectName: params.gcsObjectName
  });
  const splitResult = await splitAudioBufferIntoChunks({
    inputBuffer: sourceBuffer,
    sourceFileName: params.fileName,
    chunkDurationSec: STT_CHUNK_DURATION_SEC
  });

  const chunks =
    splitResult.needsChunking
      ? await mapWithConcurrency(splitResult.chunks, STT_CHUNK_PARALLELISM, async (chunk) => {
          const chunkObjectName = buildChunkObjectName(params.gcsObjectName, chunk.index, chunk.fileName);
          await uploadToGcs({
            accessToken: params.accessToken,
            bucket: params.gcsBucket,
            objectName: chunkObjectName,
            contentType: chunk.contentType,
            body: chunk.data
          });
          const gcsUri = `gs://${params.gcsBucket}/${chunkObjectName}`;
          const operationName = await startSpeechBatchRecognize({
            accessToken: params.accessToken,
            projectId: params.projectId,
            location: params.location,
            languageCode: "en-US",
            model: params.model,
            gcsUri
          });
          return {
            index: chunk.index,
            gcsObjectName: chunkObjectName,
            gcsUri,
            operationName,
            attemptCount: 1,
            status: "pending"
          } satisfies SttChunk;
        })
      : [
          {
            index: 0,
            gcsObjectName: params.gcsObjectName,
            gcsUri: params.gcsUri,
            operationName: await startSpeechBatchRecognize({
              accessToken: params.accessToken,
              projectId: params.projectId,
              location: params.location,
              languageCode: "en-US",
              model: params.model,
              gcsUri: params.gcsUri
            }),
            attemptCount: 1,
            status: "pending"
          } satisfies SttChunk
        ];

  return {
    chunkingEnabled: splitResult.needsChunking,
    chunkDurationSec: splitResult.chunkDurationSec,
    sourceDurationSec: splitResult.durationSec,
    chunks
  };
}

async function refreshSttChunk(params: {
  accessToken: string;
  projectId: string;
  location: string;
  model: string;
  chunk: SttChunk;
}) {
  const chunk = params.chunk;
  if (chunk.status === "completed") {
    return chunk;
  }
  if (chunk.status === "failed" && chunk.attemptCount >= STT_CHUNK_MAX_ATTEMPTS) {
    return chunk;
  }

  const operation = await getSpeechBatchOperation({
    accessToken: params.accessToken,
    location: params.location,
    operationName: chunk.operationName
  });

  if (!operation.done) {
    return {
      ...chunk,
      status: "pending"
    } satisfies SttChunk;
  }

  if (operation.error?.message) {
    return await retryOrFailChunk({
      accessToken: params.accessToken,
      projectId: params.projectId,
      location: params.location,
      model: params.model,
      chunk,
      errorMessage: operation.error.message
    });
  }

  const transcriptResult = extractTranscriptFromSpeechBatchResponse({
    response: operation.response ?? {},
    gcsUri: chunk.gcsUri
  });
  const batchFileError = transcriptResult.fileErrors.find((message) => String(message).trim().length > 0);
  if (batchFileError) {
    return await retryOrFailChunk({
      accessToken: params.accessToken,
      projectId: params.projectId,
      location: params.location,
      model: params.model,
      chunk,
      errorMessage: batchFileError
    });
  }

  const transcript = transcriptResult.transcript.trim();
  if (!transcript) {
    return await retryOrFailChunk({
      accessToken: params.accessToken,
      projectId: params.projectId,
      location: params.location,
      model: params.model,
      chunk,
      errorMessage: "Speech-to-Text returned empty transcript for chunk"
    });
  }

  return {
    ...chunk,
    status: "completed",
    transcript,
    totalResultCount: transcriptResult.totalResultCount,
    nonEmptyResultCount: transcriptResult.nonEmptyResultCount,
    emptyResultCount: transcriptResult.emptyResultCount,
    transcriptTurns: transcriptResult.turns,
    detectedSpeakerCount: transcriptResult.detectedSpeakerCount,
    errorMessage: undefined
  } satisfies SttChunk;
}

async function retryOrFailChunk(params: {
  accessToken: string;
  projectId: string;
  location: string;
  model: string;
  chunk: SttChunk;
  errorMessage: string;
}) {
  if (params.chunk.attemptCount >= STT_CHUNK_MAX_ATTEMPTS) {
    return {
      ...params.chunk,
      status: "failed",
      errorMessage: params.errorMessage
    } satisfies SttChunk;
  }

  const operationName = await startSpeechBatchRecognize({
    accessToken: params.accessToken,
    projectId: params.projectId,
    location: params.location,
    languageCode: "en-US",
    model: params.model,
    gcsUri: params.chunk.gcsUri
  });

  return {
    ...params.chunk,
    operationName,
    attemptCount: params.chunk.attemptCount + 1,
    status: "pending",
    errorMessage: params.errorMessage
  } satisfies SttChunk;
}

function mergeChunkTranscripts(chunks: SttChunk[]) {
  const completedChunks = [...chunks]
    .filter((chunk) => chunk.status === "completed" && String(chunk.transcript ?? "").trim().length > 0)
    .sort((a, b) => a.index - b.index);

  return {
    transcript: completedChunks.map((chunk) => String(chunk.transcript ?? "").trim()).join("\n").trim(),
    totalResultCount: completedChunks.reduce((sum, chunk) => sum + Number(chunk.totalResultCount ?? 0), 0),
    nonEmptyResultCount: completedChunks.reduce((sum, chunk) => sum + Number(chunk.nonEmptyResultCount ?? 0), 0),
    emptyResultCount: completedChunks.reduce((sum, chunk) => sum + Number(chunk.emptyResultCount ?? 0), 0),
    turns: [],
    detectedSpeakerCount: 0
  };
}

function summarizeChunkStates(chunks: SttChunk[]) {
  let pending = 0;
  let succeeded = 0;
  let failed = 0;
  for (const chunk of chunks) {
    if (chunk.status === "completed") {
      succeeded += 1;
    } else if (chunk.status === "failed") {
      failed += 1;
    } else {
      pending += 1;
    }
  }
  return { pending, succeeded, failed };
}

async function completeJobWithTranscript(
  serviceClient: ReturnType<typeof createAdminSupabaseClient>,
  job: SpeechFixJobRow,
  stats: JobStats,
  transcriptResult: {
    transcript: string;
    totalResultCount: number;
    nonEmptyResultCount: number;
    emptyResultCount: number;
    turns: SpeechDiarizedTurn[];
    detectedSpeakerCount: number;
  }
) {
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

  if (isLowQualityTranscript(job, transcript, transcriptResult, stats)) {
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
  const objectNames = new Set<string>();
  const gcsObjectName = normalizeGcsField(job.gcs_object_name || (typeof stats.gcsObjectName === "string" ? stats.gcsObjectName : ""));
  if (gcsObjectName) {
    objectNames.add(gcsObjectName);
  }
  for (const chunk of getSttChunks(job, stats)) {
    const chunkObjectName = normalizeGcsField(chunk.gcsObjectName);
    if (chunkObjectName) {
      objectNames.add(chunkObjectName);
    }
  }

  if (gcsBucket && objectNames.size > 0) {
    try {
      const accessToken = await getGoogleAccessToken({
        serviceAccount: parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson()),
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
      });
      await Promise.all(
        [...objectNames].map(async (objectName) => {
          await deleteFromGcs({
            accessToken,
            bucket: gcsBucket,
            objectName
          });
        })
      );
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

function getSttChunks(job: SpeechFixJobRow, stats: JobStats): SttChunk[] {
  const rawChunks = Array.isArray(stats.sttChunks) ? stats.sttChunks : [];
  const normalizedChunks = rawChunks
    .map((chunk) => normalizeSttChunk(chunk))
    .filter((chunk): chunk is SttChunk => chunk !== null)
    .sort((a, b) => a.index - b.index);
  if (normalizedChunks.length > 0) {
    return normalizedChunks;
  }

  const operationName = typeof stats.sttOperationName === "string" ? stats.sttOperationName.trim() : "";
  const gcsObjectName = normalizeGcsField(job.gcs_object_name || stats.gcsObjectName);
  const gcsUri =
    typeof stats.gcsUri === "string" && stats.gcsUri.trim().length > 0
      ? stats.gcsUri
      : gcsObjectName && job.gcs_bucket
        ? `gs://${job.gcs_bucket}/${gcsObjectName}`
        : "";
  if (!operationName || !gcsObjectName || !gcsUri) {
    return [];
  }

  return [
    {
      index: 0,
      gcsObjectName,
      gcsUri,
      operationName,
      attemptCount: 1,
      status: "pending"
    }
  ];
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
  },
  stats?: JobStats
) {
  if (stats?.partialTranscript === true) {
    return false;
  }
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

function normalizeSttChunk(value: unknown): SttChunk | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const operationName = String(row.operationName ?? "").trim();
  const gcsObjectName = normalizeGcsField(row.gcsObjectName);
  const gcsUri = String(row.gcsUri ?? "").trim();
  if (!operationName || !gcsObjectName || !gcsUri) {
    return null;
  }
  const rawStatus = String(row.status ?? "pending").trim();
  const status = rawStatus === "completed" || rawStatus === "failed" ? rawStatus : "pending";
  return {
    index: Math.max(0, Number(row.index ?? 0) || 0),
    gcsObjectName,
    gcsUri,
    operationName,
    attemptCount: Math.max(1, Number(row.attemptCount ?? 1) || 1),
    status,
    transcript: typeof row.transcript === "string" ? row.transcript : undefined,
    totalResultCount: Number.isFinite(Number(row.totalResultCount)) ? Number(row.totalResultCount) : undefined,
    nonEmptyResultCount: Number.isFinite(Number(row.nonEmptyResultCount)) ? Number(row.nonEmptyResultCount) : undefined,
    emptyResultCount: Number.isFinite(Number(row.emptyResultCount)) ? Number(row.emptyResultCount) : undefined,
    transcriptTurns: Array.isArray(row.transcriptTurns) ? (row.transcriptTurns as SpeechDiarizedTurn[]) : undefined,
    detectedSpeakerCount: Number.isFinite(Number(row.detectedSpeakerCount))
      ? Number(row.detectedSpeakerCount)
      : undefined,
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : undefined
  };
}

function buildChunkObjectName(baseObjectName: string, chunkIndex: number, fileName: string) {
  const normalizedBase = normalizeGcsField(baseObjectName).replace(/(\.[^./]+)?$/, "");
  const suffix = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${normalizedBase}__chunk_${String(chunkIndex).padStart(3, "0")}${suffix}`;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => await worker()));
  return results;
}
