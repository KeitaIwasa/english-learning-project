import { appEnv } from "@/lib/app-env";
import { buildLineAudioFile } from "@/lib/line-audio";
import { LineApiError, pushLineMessages } from "@/lib/line";
import { buildGcsV4SignedGetUrl, getGoogleAccessToken, parseGoogleServiceAccount, uploadToGcs } from "@/lib/google-cloud";
import { createAdminSupabaseClient } from "@/lib/service";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

export const MAX_LINE_DELIVERY_RETRIES = 3;
export const LINE_DELIVERY_RETRY_DELAYS_SECONDS = [30, 120, 300];
const LINE_AUDIO_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export class LineDeliveryError extends Error {
  retriable: boolean;
  requestId: string | null;

  constructor(params: { message: string; retriable: boolean; requestId?: string | null }) {
    super(params.message);
    this.name = "LineDeliveryError";
    this.retriable = params.retriable;
    this.requestId = params.requestId ?? null;
  }
}

export async function deliverReadingToLine(params: {
  adminClient: AppSupabaseClient;
  jobId: string;
  userId: string;
}) {
  const { data: job, error: jobError } = await params.adminClient
    .from("line_delivery_jobs")
    .select("id, user_id, passage_id, target_date, retry_count, line_user_id, line_retry_key")
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (jobError) {
    throw jobError;
  }
  if (!job) {
    throw new Error("LINE delivery job not found");
  }

  const { data: passage, error: passageError } = await params.adminClient
    .from("reading_passages")
    .select("id, title, body_en, used_review_targets_json, audio_base64, audio_mime_type")
    .eq("id", job.passage_id)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (passageError) {
    throw passageError;
  }
  if (!passage) {
    throw new Error("Reading passage not found");
  }
  if (!passage.audio_base64 || !passage.audio_mime_type) {
    throw new LineDeliveryError({
      message: "音声データが見つかりませんでした。",
      retriable: false
    });
  }

  const lineAudio = await buildLineAudioFile({
    audioBase64: passage.audio_base64,
    mimeType: passage.audio_mime_type
  });

  const serviceAccount = parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson());
  const accessToken = await getGoogleAccessToken({
    serviceAccount,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const bucket = appEnv.lineAudioGcsBucket();
  const objectName = `line-audio/${params.userId}/${job.target_date}/${job.id}.mp3`;

  await uploadToGcs({
    accessToken,
    bucket,
    objectName,
    contentType: lineAudio.contentType,
    body: lineAudio.bytes
  });

  const audioUrl = buildGcsV4SignedGetUrl({
    serviceAccount,
    bucket,
    objectName,
    expiresSeconds: LINE_AUDIO_URL_TTL_SECONDS
  });

  const text = buildReadingLineText({
    targetDate: job.target_date,
    title: passage.title,
    body: passage.body_en,
    reviewTargets: normalizeReviewTargets(passage.used_review_targets_json)
  });

  try {
    const response = await pushLineMessages({
      to: job.line_user_id,
      retryKey: job.line_retry_key,
      messages: [
        { type: "text", text },
        {
          type: "audio",
          originalContentUrl: audioUrl,
          duration: lineAudio.durationMs
        }
      ]
    });

    return {
      requestId: response.requestId,
      payload: {
        targetDate: job.target_date,
        title: passage.title,
        objectName,
        bucket,
        durationMs: lineAudio.durationMs,
        audioContentType: lineAudio.contentType
      }
    };
  } catch (error) {
    if (error instanceof LineApiError) {
      throw new LineDeliveryError({
        message: error.message,
        retriable: error.retriable,
        requestId: error.requestId
      });
    }
    throw error;
  }
}

function normalizeReviewTargets(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildReadingLineText(params: {
  targetDate: string;
  title: string;
  body: string;
  reviewTargets: string[];
}) {
  const parts = [`${params.targetDate} の音読文`, params.title, params.body.trim()];
  if (params.reviewTargets.length > 0) {
    parts.push(`復習ポイント: ${params.reviewTargets.join(" / ")}`);
  }
  return truncateLineText(parts.filter(Boolean).join("\n\n"));
}

function truncateLineText(text: string) {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= 4500) {
    return normalized;
  }
  return `${normalized.slice(0, 4497)}...`;
}
