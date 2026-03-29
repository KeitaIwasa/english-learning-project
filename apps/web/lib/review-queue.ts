export type QueueItem = {
  id: string;
  en: string;
  ja: string;
  nextReviewAt: string | null;
  isDue: boolean;
};

export type FlashcardRow = {
  id: string;
  en: string;
  ja: string;
  created_at: string;
};

export type FlashcardReviewRow = {
  flashcard_id: string;
  repetition: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string;
  reviewed_at: string;
};

export function buildReviewQueue(params: {
  cards: FlashcardRow[];
  reviews: FlashcardReviewRow[];
  now?: Date;
  maxQueue?: number;
}) {
  const now = params.now ?? new Date();
  const maxQueue = params.maxQueue ?? 50;

  const latestByCard = new Map<string, FlashcardReviewRow>();
  for (const review of params.reviews) {
    if (!latestByCard.has(review.flashcard_id)) {
      latestByCard.set(review.flashcard_id, review);
    }
  }

  const due: QueueItem[] = [];

  for (const card of params.cards) {
    const latest = latestByCard.get(card.id);
    const nextReviewAt = latest?.next_review_at ?? null;
    const isDue = !nextReviewAt || new Date(nextReviewAt) <= now;

    if (!isDue) {
      continue;
    }

    due.push({
      id: card.id,
      en: card.en,
      ja: card.ja,
      nextReviewAt,
      isDue
    });
  }

  const createdAtById = new Map<string, string>();
  for (const card of params.cards) {
    createdAtById.set(card.id, card.created_at);
  }

  due.sort((a, b) => {
    const nextA = a.nextReviewAt ? new Date(a.nextReviewAt).getTime() : Number.MIN_SAFE_INTEGER;
    const nextB = b.nextReviewAt ? new Date(b.nextReviewAt).getTime() : Number.MIN_SAFE_INTEGER;
    if (nextA !== nextB) {
      return nextA - nextB;
    }
    return (createdAtById.get(b.id) ?? "").localeCompare(createdAtById.get(a.id) ?? "");
  });

  let nextDueAt: string | null = null;
  for (const review of latestByCard.values()) {
    const next = new Date(review.next_review_at);
    if (next <= now) {
      continue;
    }
    if (!nextDueAt || next < new Date(nextDueAt)) {
      nextDueAt = review.next_review_at;
    }
  }

  const queue = due.slice(0, maxQueue);

  return {
    queue,
    total: queue.length,
    nextDueAt
  };
}
