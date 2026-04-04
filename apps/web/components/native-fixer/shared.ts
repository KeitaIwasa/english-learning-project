"use client";

import type { TranscriptSpeaker, TranscriptTurn } from "@/lib/native-fixer-transcript";

export type JobStatus = "uploaded" | "queued" | "processing" | "completed" | "failed";

export type HistoryItem = {
  id: string;
  fileName: string;
  customTitle: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Correction = {
  index: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
  speaker: TranscriptSpeaker;
  addedFlashcardId: string | null;
};

export type JobDetail = {
  id: string;
  fileName: string;
  customTitle: string | null;
  fileSize: number;
  mimeType: string;
  status: JobStatus;
  transcriptFull: string | null;
  transcriptTurns: TranscriptTurn[];
  corrections: Correction[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ModalState = {
  correctionIndex: number;
  corrected: string;
  ja: string;
};

export type ViewMode = "create" | "history";
export type CorrectionSpeakerFilter = "all" | "speaker1" | "speaker2";

export function formatNativeFixerDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
