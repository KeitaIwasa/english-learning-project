import { appEnv } from "@/lib/app-env";
import {
  deleteFromGcs,
  getGoogleAccessToken,
  getGoogleProjectIdFromServiceAccountJson,
  parseGoogleServiceAccount,
  type SpeechDiarizedTurn
} from "@/lib/google-cloud";
import { createAdminSupabaseClient } from "@/lib/service";
import { buildCompletedJobArtifacts } from "@/lib/speech-fixer-process/completion";
import { createSttChunks, mergeChunkTranscripts, refreshSttChunk, STT_CHUNK_PARALLELISM, summarizeChunkStates } from "@/lib/speech-fixer-process/stt";
import type { JobStats, SpeechFixJobRow, SttChunk } from "@/lib/speech-fixer-process/types";
import { asIsoString, diffMs, getStats, getSttChunks, mapWithConcurrency, normalizeGcsField } from "@/lib/speech-fixer-process/utils";

const MAX_BATCH_DEFAULT = 3;
const STT_STARTUP_GRACE_MS = 5 * 60 * 1000;

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
  const artifacts = await buildCompletedJobArtifacts({
    job,
    stats,
    transcriptResult
  });

  if (!artifacts.ok) {
    await failJob(serviceClient, job, artifacts.reason, artifacts.stats);
    return "failed" as const;
  }

  const { error: updateError } = await serviceClient
    .from("speech_fix_jobs")
    .update({
      status: "completed",
      transcript_full: artifacts.transcript,
      corrections_json: artifacts.corrections,
      stats_json: artifacts.stats,
      error_message: null,
      completed_at: artifacts.completedAt
    })
    .eq("id", job.id);

  if (updateError) {
    throw updateError;
  }

  await cleanupTempAudio(serviceClient, {
    ...job,
    stats_json: artifacts.stats
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
