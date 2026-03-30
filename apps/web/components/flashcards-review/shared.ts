"use client";

export type QueueItem = {
  id: string;
  en: string;
  ja: string;
  nextReviewAt: string | null;
  isDue: boolean;
};

export type QueueResponse = {
  queue?: QueueItem[];
  total?: number;
  nextDueAt?: string | null;
  error?: string;
};

export type ReviewResponse = {
  ok?: boolean;
  skipped?: boolean;
  nextReviewAt?: string;
  flashcardId?: string;
  nextDueAt?: string | null;
  error?: string;
};

export type ReviewAttempt = {
  flashcardId: string;
  remembered: boolean;
  card: QueueItem;
};

export type ReviewSaveError = {
  message: string;
  attempt: ReviewAttempt;
};

export type Sm2Info = {
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  reviewedAt: string;
};

export type RecentCardWithSm2 = {
  id: string;
  en: string;
  ja: string;
  created_at: string;
  updated_at: string;
  sm2: Sm2Info | null;
};

export type RecentCardsResponse = {
  items?: RecentCardWithSm2[];
  total?: number;
  limit?: number;
  offset?: number;
  error?: string;
};

export function formatFlashcardDateTime(value: string | null) {
  if (!value) {
    return "未定";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
