import { buildSpeechFixCorrections } from "@/lib/speech-fixer";
import type { TranscriptResult, JobStats, SpeechFixJobRow } from "@/lib/speech-fixer-process/types";
import { asIsoString, diffMs, isLowQualityTranscript } from "@/lib/speech-fixer-process/utils";

export async function buildCompletedJobArtifacts(params: {
  job: SpeechFixJobRow;
  stats: JobStats;
  transcriptResult: TranscriptResult;
}) {
  const transcript = params.transcriptResult.transcript.trim();
  if (!transcript) {
    return {
      ok: false as const,
      reason: "Speech-to-Text returned empty transcript",
      stats: {
        ...params.stats,
        sttTranscriptLength: 0,
        sttResultCount: params.transcriptResult.totalResultCount,
        sttNonEmptyResultCount: params.transcriptResult.nonEmptyResultCount,
        sttEmptyResultCount: params.transcriptResult.emptyResultCount
      }
    };
  }

  if (isLowQualityTranscript(params.job, transcript, params.transcriptResult, params.stats)) {
    return {
      ok: false as const,
      reason: "Speech-to-Text transcript appears low quality",
      stats: {
        ...params.stats,
        sttTranscriptLength: transcript.length,
        sttResultCount: params.transcriptResult.totalResultCount,
        sttNonEmptyResultCount: params.transcriptResult.nonEmptyResultCount,
        sttEmptyResultCount: params.transcriptResult.emptyResultCount
      }
    };
  }

  const correctionStartedAt = new Date().toISOString();
  const corrections = await buildSpeechFixCorrections({
    transcript,
    transcriptTurns: params.transcriptResult.turns
  });
  const correctionCompletedAt = new Date().toISOString();
  const sttCompletedAt = correctionStartedAt;

  return {
    ok: true as const,
    transcript,
    corrections,
    completedAt: correctionCompletedAt,
    stats: {
      ...params.stats,
      sttTranscriptLength: transcript.length,
      sttResultCount: params.transcriptResult.totalResultCount,
      sttNonEmptyResultCount: params.transcriptResult.nonEmptyResultCount,
      sttEmptyResultCount: params.transcriptResult.emptyResultCount,
      sttDetectedSpeakerCount: params.transcriptResult.detectedSpeakerCount,
      transcriptTurns: params.transcriptResult.turns,
      transcriptLength: transcript.length,
      correctionCount: corrections.length,
      sttCompletedAt,
      correctionStartedAt,
      correctionCompletedAt,
      sttMs: diffMs(asIsoString(params.stats.sttStartedAt), sttCompletedAt),
      correctionMs: diffMs(correctionStartedAt, correctionCompletedAt),
      totalMs: diffMs(asIsoString(params.stats.queuedAt) ?? params.job.created_at, correctionCompletedAt)
    }
  };
}
