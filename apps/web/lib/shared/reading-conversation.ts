export type ReadingChatMessage = {
  mode: string;
  role: string;
  content: string;
  createdAt: string;
  threadId: string | null;
};

export type ReadingFlashcard = {
  id: string;
  en: string;
  ja: string;
  createdAt: string;
};

export type ReadingFlashcardReview = {
  flashcardId: string;
  quality: number;
  reviewedAt: string;
};

export type ReadingConversationTurn = {
  role: "user" | "model";
  text: string;
};

type ConversationEvent = {
  kind: "ask" | "translate" | "flashcard";
  createdAt: number;
  turns: ReadingConversationTurn[];
  charCount: number;
  reviewTarget?: string;
  newTarget?: string;
};

export type ReadingConversationStats = {
  askCount: number;
  translatePairCount: number;
  flashcardPairCount: number;
  trimmedCount: number;
  contextChars: number;
  totalEvents: number;
};

export type ReadingConversationResult = {
  turns: ReadingConversationTurn[];
  usedReviewTargets: string[];
  usedNewTargets: string[];
  stats: ReadingConversationStats;
};

export function buildReadingConversation(params: {
  chatMessages: ReadingChatMessage[];
  flashcards: ReadingFlashcard[];
  flashcardReviews: ReadingFlashcardReview[];
  maxChars: number;
}): ReadingConversationResult {
  const askEvents = buildAskEvents(params.chatMessages);
  const translateEvents = buildTranslateEvents(params.chatMessages);
  const flashcardEvents = buildFlashcardEvents(params.flashcards, params.flashcardReviews);

  const events = [...askEvents, ...translateEvents, ...flashcardEvents].sort((a, b) => a.createdAt - b.createdAt);

  const maxChars = Math.max(0, params.maxChars);
  let contextChars = events.reduce((sum, event) => sum + event.charCount, 0);
  let start = 0;

  while (contextChars > maxChars && start < events.length) {
    contextChars -= events[start].charCount;
    start += 1;
  }

  const trimmedCount = start;
  const keptEvents = events.slice(start);
  const usedReviewTargets = unique(
    keptEvents
      .filter((event) => event.kind === "flashcard")
      .map((event) => event.reviewTarget ?? "")
      .filter((value) => value.length > 0)
  );
  const usedNewTargets = unique(
    keptEvents
      .filter((event) => event.kind === "translate")
      .map((event) => event.newTarget ?? "")
      .filter((value) => value.length > 0)
  );

  return {
    turns: keptEvents.flatMap((event) => event.turns),
    usedReviewTargets,
    usedNewTargets,
    stats: {
      askCount: keptEvents.filter((event) => event.kind === "ask").length,
      translatePairCount: keptEvents.filter((event) => event.kind === "translate").length,
      flashcardPairCount: keptEvents.filter((event) => event.kind === "flashcard").length,
      trimmedCount,
      contextChars,
      totalEvents: keptEvents.length
    }
  };
}

function buildAskEvents(chatMessages: ReadingChatMessage[]): ConversationEvent[] {
  return chatMessages
    .filter((row) => row.mode === "ask")
    .sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt))
    .flatMap((row) => {
      const text = String(row.content ?? "").trim();
      if (!text) {
        return [];
      }

      if (row.role !== "user" && row.role !== "assistant") {
        return [];
      }

      const role: "user" | "model" = row.role === "assistant" ? "model" : "user";
      const turns: ReadingConversationTurn[] = [{ role, text }];
      return [toEvent("ask", row.createdAt, turns)];
    });
}

function buildTranslateEvents(chatMessages: ReadingChatMessage[]): ConversationEvent[] {
  const byThread = new Map<string, ReadingChatMessage[]>();
  for (const row of chatMessages) {
    if (row.mode !== "translate" || !row.threadId) {
      continue;
    }
    const text = String(row.content ?? "").trim();
    if (!text) {
      continue;
    }
    if (row.role !== "user" && row.role !== "assistant") {
      continue;
    }
    const list = byThread.get(row.threadId) ?? [];
    list.push(row);
    byThread.set(row.threadId, list);
  }

  const events: ConversationEvent[] = [];
  for (const list of byThread.values()) {
    list.sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt));
    for (let i = 0; i < list.length - 1; i += 1) {
      const userRow = list[i];
      const assistantRow = list[i + 1];
      if (userRow.role !== "user" || assistantRow.role !== "assistant") {
        continue;
      }

      const source = userRow.content.trim();
      const response = assistantRow.content.trim();
      if (!source || !response) {
        continue;
      }

      const turns: ReadingConversationTurn[] = [
        { role: "user", text: `翻訳して\n${source}` },
        { role: "model", text: response }
      ];

      const event = toEvent("translate", assistantRow.createdAt, turns);
      event.newTarget = source;
      events.push(event);
      i += 1;
    }
  }

  return events;
}

function buildFlashcardEvents(flashcards: ReadingFlashcard[], flashcardReviews: ReadingFlashcardReview[]): ConversationEvent[] {
  const latestByCard = new Map<string, ReadingFlashcardReview>();
  for (const review of flashcardReviews) {
    const prev = latestByCard.get(review.flashcardId);
    if (!prev || parseTime(review.reviewedAt) > parseTime(prev.reviewedAt)) {
      latestByCard.set(review.flashcardId, review);
    }
  }

  const events: ConversationEvent[] = [];
  for (const card of flashcards) {
    const en = String(card.en ?? "").trim();
    const ja = String(card.ja ?? "").trim();
    if (!en || !ja) {
      continue;
    }

    const latest = latestByCard.get(card.id);
    const isUnmastered = !latest || Number(latest.quality) < 3;
    if (!isUnmastered) {
      continue;
    }

    const turns: ReadingConversationTurn[] = [
      { role: "user", text: `翻訳して\n${ja}` },
      { role: "model", text: en }
    ];
    const event = toEvent("flashcard", latest?.reviewedAt ?? card.createdAt, turns);
    event.reviewTarget = en;
    events.push(event);
  }

  return events;
}

function toEvent(kind: ConversationEvent["kind"], createdAt: string, turns: ReadingConversationTurn[]): ConversationEvent {
  return {
    kind,
    createdAt: parseTime(createdAt),
    turns,
    charCount: turns.reduce((sum, turn) => sum + turn.text.length, 0)
  };
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
