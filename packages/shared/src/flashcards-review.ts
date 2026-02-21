export type FlashcardReviewQueueInput = {
  id: string;
  en: string;
  ja: string;
  createdAt: string;
  nextReviewAt: string | null;
};

export type FlashcardReviewQueueItem = {
  id: string;
  en: string;
  ja: string;
  nextReviewAt: string | null;
  isDue: boolean;
};

export function buildFlashcardReviewQueue(
  cards: FlashcardReviewQueueInput[],
  nowIso: string,
  limit = 50
): { queue: FlashcardReviewQueueItem[]; total: number; nextDueAt: string | null } {
  const now = new Date(nowIso);

  const due: FlashcardReviewQueueItem[] = [];
  const notDue: FlashcardReviewQueueItem[] = [];

  for (const card of cards) {
    const isDue = Boolean(card.nextReviewAt && new Date(card.nextReviewAt) <= now);
    const item: FlashcardReviewQueueItem = {
      id: card.id,
      en: card.en,
      ja: card.ja,
      nextReviewAt: card.nextReviewAt,
      isDue
    };

    if (isDue) {
      due.push(item);
    } else {
      notDue.push(item);
    }
  }

  const createdAtById = new Map(cards.map((card) => [card.id, card.createdAt]));

  due.sort((a, b) => {
    const nextA = a.nextReviewAt ? new Date(a.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
    const nextB = b.nextReviewAt ? new Date(b.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (nextA !== nextB) {
      return nextA - nextB;
    }
    return (createdAtById.get(b.id) ?? "").localeCompare(createdAtById.get(a.id) ?? "");
  });

  notDue.sort((a, b) => (createdAtById.get(b.id) ?? "").localeCompare(createdAtById.get(a.id) ?? ""));

  const queue = [...due, ...notDue].slice(0, limit);

  let nextDueAt: string | null = null;
  for (const card of cards) {
    if (!card.nextReviewAt) {
      continue;
    }
    const next = new Date(card.nextReviewAt);
    if (next <= now) {
      continue;
    }
    if (!nextDueAt || next < new Date(nextDueAt)) {
      nextDueAt = card.nextReviewAt;
    }
  }

  return {
    queue,
    total: queue.length,
    nextDueAt
  };
}
