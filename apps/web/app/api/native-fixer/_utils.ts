import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getServiceEnv } from "@/lib/service";
import type { Json } from "@/types/supabase";

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

export async function requireAuthUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return {
    supabase,
    user: data.user
  };
}

export function createAdminSupabaseClient() {
  const { supabaseUrl, serviceRoleKey } = getServiceEnv();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
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

export function createGcsObjectName(params: { userId: string; jobId: string; fileName: string }) {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `speech-fixer/${params.userId}/${params.jobId}/${safeName}`;
}
