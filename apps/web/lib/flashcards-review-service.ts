import { nextSm2 } from "@english/shared";
import {
  buildReviewQueue,
  type FlashcardReviewRow,
  type FlashcardRow,
  type QueueItem
} from "@/lib/review-queue";
import { createAdminSupabaseClient } from "@/lib/service";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

const MAX_REVIEW_QUEUE = 50;

export async function findNextDueAt(params: { serviceClient: AppSupabaseClient; userId: string }): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await params.serviceClient
    .from("flashcard_reviews")
    .select("next_review_at")
    .eq("user_id", params.userId)
    .gt("next_review_at", nowIso)
    .order("next_review_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.next_review_at ?? null;
}

export async function loadReviewQueue(params: {
  serviceClient: AppSupabaseClient;
  userId: string;
}): Promise<{ queue: QueueItem[]; total: number; nextDueAt: string | null }> {
  const { data: cards, error: cardsError } = await params.serviceClient
    .from("flashcards")
    .select("id, en, ja, created_at")
    .eq("user_id", params.userId);

  if (cardsError) {
    throw cardsError;
  }

  const { data: reviews, error: reviewsError } = await params.serviceClient
    .from("flashcard_reviews")
    .select("flashcard_id, repetition, interval_days, ease_factor, next_review_at, reviewed_at")
    .eq("user_id", params.userId)
    .order("reviewed_at", { ascending: false });

  if (reviewsError) {
    throw reviewsError;
  }

  return buildReviewQueue({
    cards: (cards ?? []) as FlashcardRow[],
    reviews: (reviews ?? []) as FlashcardReviewRow[],
    maxQueue: MAX_REVIEW_QUEUE
  });
}

export async function submitFlashcardReview(params: {
  serviceClient: AppSupabaseClient;
  userId: string;
  flashcardId: string;
  remembered: boolean;
}) {
  const { data: card, error: cardError } = await params.serviceClient
    .from("flashcards")
    .select("id")
    .eq("id", params.flashcardId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (cardError) {
    throw cardError;
  }
  if (!card) {
    return {
      ok: true as const,
      skipped: true as const,
      flashcardId: params.flashcardId,
      nextDueAt: await findNextDueAt(params)
    };
  }

  const { data: latestReview, error: latestReviewError } = await params.serviceClient
    .from("flashcard_reviews")
    .select("repetition, interval_days, ease_factor")
    .eq("user_id", params.userId)
    .eq("flashcard_id", params.flashcardId)
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestReviewError) {
    throw latestReviewError;
  }

  const quality = params.remembered ? 4 : 2;
  const sm2 = nextSm2({
    quality,
    repetition: latestReview?.repetition ?? 0,
    intervalDays: latestReview?.interval_days ?? 1,
    easeFactor: latestReview?.ease_factor ?? 2.5
  });

  const nextReviewAt = new Date();
  nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + sm2.intervalDays);

  const { error: insertError } = await params.serviceClient.from("flashcard_reviews").insert({
    flashcard_id: params.flashcardId,
    user_id: params.userId,
    quality,
    interval_days: sm2.intervalDays,
    ease_factor: sm2.easeFactor,
    repetition: sm2.repetition,
    next_review_at: nextReviewAt.toISOString()
  });

  if (insertError) {
    throw insertError;
  }

  return {
    ok: true as const,
    nextReviewAt: nextReviewAt.toISOString(),
    flashcardId: params.flashcardId,
    nextDueAt: await findNextDueAt(params)
  };
}
