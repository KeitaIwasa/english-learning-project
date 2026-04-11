import type { SpeechDiarizedTurn } from "@/lib/google-cloud";
import type { JobStats, SpeechFixJobRow, SttChunk } from "@/lib/speech-fixer-process/types";

export const MIN_TRANSCRIPT_LENGTH_FOR_LARGE_FILE = 80;
export const LARGE_FILE_BYTES = 2_000_000;

export function getStats(job: SpeechFixJobRow): JobStats {
  if (!job.stats_json || typeof job.stats_json !== "object" || Array.isArray(job.stats_json)) {
    return {};
  }
  return job.stats_json as JobStats;
}

export function getSttChunks(job: SpeechFixJobRow, stats: JobStats): SttChunk[] {
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

export function asIsoString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function diffMs(start: string | null, end: string | null): number | null {
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

export function isLowQualityTranscript(
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

export function normalizeGcsField(value: unknown): string {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}

export function normalizeSttChunk(value: unknown): SttChunk | null {
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
    operationStartedAt: typeof row.operationStartedAt === "string" ? row.operationStartedAt : undefined,
    operationUpdatedAt: typeof row.operationUpdatedAt === "string" ? row.operationUpdatedAt : undefined,
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

export function buildChunkObjectName(baseObjectName: string, chunkIndex: number, fileName: string) {
  const normalizedBase = normalizeGcsField(baseObjectName).replace(/(\.[^./]+)?$/, "");
  const suffix = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${normalizedBase}__chunk_${String(chunkIndex).padStart(3, "0")}${suffix}`;
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
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
