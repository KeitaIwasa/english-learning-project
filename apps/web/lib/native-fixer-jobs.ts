import { addFlashcard } from "@/lib/flashcards";
import { buildGcsV4SignedPutUrl, checkGcsObjectExists, getGoogleAccessToken, parseGoogleServiceAccount } from "@/lib/google-cloud";
import { enqueueWorkerTask } from "@/lib/cloud-tasks";
import { createAdminSupabaseClient } from "@/lib/service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Json } from "@/types/supabase";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient> | Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type SpeechFixStatus = "uploaded" | "queued" | "processing" | "completed" | "failed";

export type SpeechFixCorrection = {
  index: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
  speaker: 1 | 2 | "unknown";
  addedFlashcardId: string | null;
};

export type SpeechFixTranscriptTurn = {
  speaker: 1 | 2 | "unknown";
  text: string;
};

export type SpeechFixJob = {
  id: string;
  user_id: string;
  file_name: string;
  custom_title: string | null;
  file_size: number;
  mime_type: string;
  status: SpeechFixStatus;
  gcs_bucket: string | null;
  gcs_object_name: string | null;
  gcs_upload_completed_at: string | null;
  transcript_full: string | null;
  corrections_json: Json;
  stats_json: Json;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const GCS_SIGN_EXPIRES_SECONDS = 15 * 60;

export async function listSpeechFixJobs(params: { supabase: AppSupabaseClient; userId: string }) {
  const { data, error } = await params.supabase
    .from("speech_fix_jobs")
    .select("id, file_name, custom_title, status, created_at, completed_at, updated_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  return {
    items: (data ?? []).map((item) => ({
      id: item.id,
      fileName: item.file_name,
      customTitle: item.custom_title,
      status: item.status,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      completedAt: item.completed_at
    }))
  };
}

export async function createSpeechFixJob(params: {
  supabase: AppSupabaseClient;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}) {
  const bucket = normalizeGcsField(process.env.GCS_TEMP_BUCKET);
  const serviceAccountJson = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "").trim();
  if (!bucket || !serviceAccountJson) {
    throw new Error("Missing GCS_TEMP_BUCKET or GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }

  const { data: created, error: createError } = await params.supabase
    .from("speech_fix_jobs")
    .insert({
      user_id: params.userId,
      file_name: params.fileName,
      file_size: params.fileSize,
      mime_type: params.mimeType,
      status: "uploaded"
    })
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message ?? "Failed to create job");
  }

  const createdJob = created as SpeechFixJob;
  const gcsObjectName = createGcsObjectName({
    userId: params.userId,
    jobId: createdJob.id,
    fileName: params.fileName
  });

  const { error: pathSaveError } = await params.supabase
    .from("speech_fix_jobs")
    .update({
      gcs_bucket: bucket,
      gcs_object_name: gcsObjectName
    })
    .eq("id", createdJob.id);

  if (pathSaveError) {
    throw pathSaveError;
  }

  const serviceAccount = parseGoogleServiceAccount(serviceAccountJson);
  return {
    jobId: createdJob.id,
    gcsObjectName,
    gcsSignedUploadUrl: buildGcsV4SignedPutUrl({
      serviceAccount,
      bucket,
      objectName: gcsObjectName,
      contentType: params.mimeType,
      expiresSeconds: GCS_SIGN_EXPIRES_SECONDS
    }),
    requiredHeaders: {
      "Content-Type": params.mimeType
    }
  };
}

export async function getSpeechFixJobDetail(params: {
  supabase: AppSupabaseClient;
  userId: string;
  jobId: string;
}) {
  const { data, error } = await params.supabase
    .from("speech_fix_jobs")
    .select("*")
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const stats = (data.stats_json ?? {}) as { transcriptTurns?: Json };
  return {
    item: {
      id: data.id,
      fileName: data.file_name,
      customTitle: data.custom_title,
      fileSize: data.file_size,
      mimeType: data.mime_type,
      status: data.status,
      transcriptFull: data.transcript_full,
      transcriptTurns: normalizeTranscriptTurns(stats.transcriptTurns ?? []),
      corrections: normalizeCorrections(data.corrections_json),
      errorMessage: data.error_message,
      stats: data.stats_json,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      completedAt: data.completed_at
    }
  };
}

export async function updateSpeechFixJobTitle(params: {
  supabase: AppSupabaseClient;
  userId: string;
  jobId: string;
  customTitle: string | null;
}) {
  const { data, error } = await params.supabase
    .from("speech_fix_jobs")
    .update({
      custom_title: params.customTitle
    })
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .select("id, custom_title")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return { ok: true, id: data.id, customTitle: data.custom_title };
}

export async function completeUploadedSpeechFixJob(params: {
  supabase: AppSupabaseClient;
  userId: string;
  jobId: string;
}) {
  const { data: job, error: findError } = await params.supabase
    .from("speech_fix_jobs")
    .select("id, status, gcs_bucket, gcs_object_name, stats_json")
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .eq("status", "uploaded")
    .maybeSingle();

  if (findError) {
    throw findError;
  }
  if (!job) {
    return { ok: false as const, status: 409, error: "Not found or invalid state" };
  }

  const gcsBucket = normalizeGcsField(job.gcs_bucket);
  const gcsObjectName = normalizeGcsField(job.gcs_object_name);
  if (!gcsBucket || !gcsObjectName) {
    return { ok: false as const, status: 500, error: "GCS object info missing on job" };
  }

  const serviceAccountRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "").trim();
  if (!serviceAccountRaw) {
    return { ok: false as const, status: 500, error: "Missing GOOGLE_APPLICATION_CREDENTIALS_JSON" };
  }

  const serviceAccount = parseGoogleServiceAccount(serviceAccountRaw);
  const accessToken = await getGoogleAccessToken({
    serviceAccount,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const objectState = await checkGcsObjectExists({
    accessToken,
    bucket: gcsBucket,
    objectName: gcsObjectName
  });
  if (!objectState.exists) {
    return { ok: false as const, status: 409, error: "Uploaded object not found in GCS" };
  }

  const queuedAt = new Date().toISOString();
  const baseStats = job.stats_json && typeof job.stats_json === "object" && !Array.isArray(job.stats_json) ? job.stats_json : {};
  const { data, error } = await params.supabase
    .from("speech_fix_jobs")
    .update({
      status: "queued",
      error_message: null,
      gcs_upload_completed_at: queuedAt,
      stats_json: {
        ...baseStats,
        queuedAt,
        uploadBytes: objectState.size ?? null,
        uploadContentType: objectState.contentType || null,
        gcsBucket,
        gcsObjectName
      }
    })
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .eq("status", "uploaded")
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return { ok: false as const, status: 409, error: "Not found or invalid state" };
  }

  void triggerSpeechFixerOnce();

  return { ok: true as const, id: data.id, status: data.status };
}

export async function addSpeechFixCorrectionFlashcard(params: {
  supabase: AppSupabaseClient;
  adminClient: AppSupabaseClient;
  userId: string;
  jobId: string;
  correctionIndex: number;
  en: string;
  ja?: string;
}) {
  const { data: job, error: jobError } = await params.supabase
    .from("speech_fix_jobs")
    .select("id, corrections_json")
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (jobError) {
    throw jobError;
  }
  if (!job) {
    return { ok: false as const, status: 404, error: "Job not found" };
  }

  const corrections = normalizeCorrections(job.corrections_json);
  const target = corrections[params.correctionIndex];
  if (!target) {
    return { ok: false as const, status: 404, error: "Correction not found" };
  }
  if (target.addedFlashcardId) {
    return { ok: false as const, status: 409, error: "Already added", flashcardId: target.addedFlashcardId };
  }

  const result = await addFlashcard({
    serviceClient: params.adminClient,
    userId: params.userId,
    en: params.en,
    ja: params.ja,
    source: "web"
  });

  corrections[params.correctionIndex] = {
    ...target,
    addedFlashcardId: result.id
  };

  const { error: saveError } = await params.supabase
    .from("speech_fix_jobs")
    .update({
      corrections_json: corrections
    })
    .eq("id", params.jobId)
    .eq("user_id", params.userId);

  if (saveError) {
    throw saveError;
  }

  return {
    ok: true as const,
    flashcardId: result.id,
    duplicated: Boolean(result.duplicated)
  };
}

export function normalizeCorrections(value: Json): SpeechFixCorrection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SpeechFixCorrection[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, Json>;
    const original = String(record.original ?? "").trim();
    const corrected = String(record.corrected ?? "").trim();
    const ja = String(record.ja ?? "").trim();
    const reasonJa = String(record.reasonJa ?? "").trim();
    if (!original || !corrected || !ja || !reasonJa) {
      continue;
    }
    const speaker = normalizeSpeaker(record.speaker);
    const index = Number.isFinite(Number(record.index)) ? Number(record.index) : i + 1;
    const addedFlashcardId = record.addedFlashcardId ? String(record.addedFlashcardId) : null;
    out.push({
      index,
      original,
      corrected,
      ja,
      reasonJa,
      speaker,
      addedFlashcardId
    });
  }
  return out;
}

export function normalizeTranscriptTurns(value: Json): SpeechFixTranscriptTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SpeechFixTranscriptTurn[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, Json>;
    const text = String(record.text ?? "").trim();
    if (!text) {
      continue;
    }
    out.push({
      speaker: normalizeSpeaker(record.speaker),
      text
    });
  }
  return out;
}

export function createGcsObjectName(params: { userId: string; jobId: string; fileName: string }) {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `speech-fixer/${params.userId}/${params.jobId}/${safeName}`;
}

function normalizeSpeaker(value: Json): 1 | 2 | "unknown" {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "1" || text === "speaker1" || text === "speaker_1") {
    return 1;
  }
  if (text === "2" || text === "speaker2" || text === "speaker_2") {
    return 2;
  }
  return "unknown";
}

function normalizeGcsField(value: unknown): string {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}

async function triggerSpeechFixerOnce() {
  try {
    await enqueueWorkerTask({
      kind: "speech_fixer",
      payload: { limit: 1, trigger: "upload_complete" }
    });
  } catch (error) {
    console.error(`[native-fixer] failed to trigger speech-fixer-process immediately: ${String(error)}`);
  }
}
