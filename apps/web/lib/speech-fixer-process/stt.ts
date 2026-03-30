import { ensureFfmpegAvailable, splitAudioBufferIntoChunks } from "@/lib/audio-chunking";
import {
  downloadFromGcs,
  extractTranscriptFromSpeechBatchResponse,
  getSpeechBatchOperation,
  startSpeechBatchRecognize,
  uploadToGcs
} from "@/lib/google-cloud";
import type { SttChunk, TranscriptResult } from "@/lib/speech-fixer-process/types";
import { buildChunkObjectName, mapWithConcurrency } from "@/lib/speech-fixer-process/utils";

export const STT_CHUNK_DURATION_SEC = 15 * 60;
export const STT_CHUNK_PARALLELISM = 4;
export const STT_CHUNK_MAX_ATTEMPTS = 2;

export async function createSttChunks(params: {
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

export async function refreshSttChunk(params: {
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

export function mergeChunkTranscripts(chunks: SttChunk[]): TranscriptResult {
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

export function summarizeChunkStates(chunks: SttChunk[]) {
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
