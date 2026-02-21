import { corsHeaders } from "../_shared/cors.ts";
import { appEnv } from "../_shared/env.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  deleteFromGcs,
  extractTranscriptFromSpeechResponse,
  getGoogleAccessToken,
  getSpeechOperation,
  startSpeechLongRunningRecognize,
  uploadToGcs
} from "../_shared/google-cloud.ts";
import { buildSpeechFixCorrections } from "../_shared/speech-fixer.ts";

type SpeechFixJobRow = {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  status: "uploaded" | "queued" | "processing" | "completed" | "failed";
  storage_path: string | null;
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
    if (!authHeader || authHeader !== appEnv.supabaseServiceRoleKey()) {
      return json({ error: "Unauthorized" }, 401);
    }

    const serviceClient = createServiceClient();
    const payload = await readBody(req);
    const limit = Math.max(1, Math.min(10, Number(payload?.limit ?? MAX_BATCH_DEFAULT)));

    const processingResult = await runProcessingJobs(serviceClient, limit);
    const queuedResult = await runQueuedJobs(serviceClient, limit);

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
  const bucket = appEnv.speechFixerTempBucket();
  const gcsBucket = appEnv.googleCloudTempBucket();

  try {
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

    if (!job.storage_path) {
      await failJob(serviceClient, job, "storage_path is missing");
      return false;
    }

    const { data: fileData, error: downloadError } = await serviceClient.storage.from(bucket).download(job.storage_path);
    if (downloadError || !fileData) {
      await failJob(serviceClient, job, `audio download failed: ${downloadError?.message ?? "missing file"}`);
      return false;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength === 0) {
      await failJob(serviceClient, job, "audio file is empty");
      return false;
    }

    const googleAccessToken = await getGoogleAccessToken({
      serviceAccountJson: appEnv.googleApplicationCredentialsJson(),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    const safeFileName = job.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `speech-fixer/${job.user_id}/${job.id}/${safeFileName}`;
    const gcsUri = await uploadToGcs({
      accessToken: googleAccessToken,
      bucket: gcsBucket,
      objectName,
      contentType: job.mime_type || "application/octet-stream",
      bytes
    });

    const operationName = await startSpeechLongRunningRecognize({
      accessToken: googleAccessToken,
      languageCode: "en-US",
      gcsUri
    });

    const nextStats = {
      ...getStats(job),
      gcsBucket,
      gcsObjectName: objectName,
      gcsUri,
      sttOperationName: operationName,
      sttStartedAt: new Date().toISOString()
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

    const corrections = await buildSpeechFixCorrections(transcript);
    const completedAt = new Date().toISOString();
    const nextStats = {
      ...stats,
      transcriptLength: transcript.length,
      correctionCount: corrections.length,
      sttCompletedAt: completedAt
    };

    const { error: updateError } = await serviceClient
      .from("speech_fix_jobs")
      .update({
        status: "completed",
        transcript_full: transcript,
        corrections_json: corrections,
        stats_json: nextStats,
        error_message: null,
        completed_at: completedAt
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
  const bucket = appEnv.speechFixerTempBucket();
  const stats = getStats(job);
  const gcsBucket = typeof stats.gcsBucket === "string" ? stats.gcsBucket : "";
  const gcsObjectName = typeof stats.gcsObjectName === "string" ? stats.gcsObjectName : "";

  if (job.storage_path) {
    const { error } = await serviceClient.storage.from(bucket).remove([job.storage_path]);
    if (error) {
      console.error(`[speech-fixer] failed to remove supabase temp file: ${error.message}`);
    }
  }

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

  await serviceClient
    .from("speech_fix_jobs")
    .update({
      storage_path: null
    })
    .eq("id", job.id);
}

function getStats(job: SpeechFixJobRow): JobStats {
  if (!job.stats_json || typeof job.stats_json !== "object" || Array.isArray(job.stats_json)) {
    return {};
  }
  return job.stats_json as JobStats;
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
