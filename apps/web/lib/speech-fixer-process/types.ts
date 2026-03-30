import type { SpeechDiarizedTurn } from "@/lib/google-cloud";

export type SpeechFixJobRow = {
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

export type SttChunk = {
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

export type JobStats = {
  sttOperationName?: string;
  gcsBucket?: string;
  gcsObjectName?: string;
  gcsUri?: string;
  sttChunks?: SttChunk[];
  [key: string]: unknown;
};

export type TranscriptResult = {
  transcript: string;
  totalResultCount: number;
  nonEmptyResultCount: number;
  emptyResultCount: number;
  turns: SpeechDiarizedTurn[];
  detectedSpeakerCount: number;
};
