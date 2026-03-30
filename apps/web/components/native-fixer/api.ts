"use client";

import type { HistoryItem, JobDetail } from "./shared";

export async function fetchNativeFixerHistory() {
  const response = await fetch("/api/native-fixer/jobs", { method: "GET" });
  const json = (await response.json()) as { items?: HistoryItem[]; error?: string };
  return { response, json };
}

export async function fetchNativeFixerDetail(jobId: string) {
  const response = await fetch(`/api/native-fixer/jobs/${jobId}`, { method: "GET" });
  const json = (await response.json()) as { item?: JobDetail; error?: string };
  return { response, json };
}

export async function updateNativeFixerTitle(itemId: string, customTitle: string) {
  const response = await fetch(`/api/native-fixer/jobs/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customTitle })
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return { response, json };
}

export async function createNativeFixerJob(file: File) {
  const response = await fetch("/api/native-fixer/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "audio/mpeg"
    })
  });
  const json = (await response.json()) as {
    jobId?: string;
    gcsObjectName?: string;
    gcsSignedUploadUrl?: string;
    requiredHeaders?: Record<string, string>;
    error?: string;
  };
  return { response, json };
}

export async function uploadNativeFixerFile(params: {
  file: File;
  gcsSignedUploadUrl: string;
  requiredHeaders?: Record<string, string>;
}) {
  return await fetch(params.gcsSignedUploadUrl, {
    method: "PUT",
    headers: params.requiredHeaders ?? { "Content-Type": params.file.type || "audio/mpeg" },
    body: params.file
  });
}

export async function queueNativeFixerJob(jobId: string) {
  return await fetch(`/api/native-fixer/jobs/${jobId}/upload-complete`, {
    method: "POST"
  });
}

export async function addNativeFixerFlashcard(params: {
  jobId: string;
  correctionIndex: number;
  en: string;
  ja?: string;
}) {
  const response = await fetch(`/api/native-fixer/jobs/${params.jobId}/corrections/${params.correctionIndex}/add-flashcard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      en: params.en,
      ja: params.ja
    })
  });
  const json = (await response.json()) as { error?: unknown; flashcardId?: string };
  return { response, json };
}
