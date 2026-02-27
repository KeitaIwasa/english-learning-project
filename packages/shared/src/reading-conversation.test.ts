import { describe, expect, it } from "vitest";
import { buildReadingConversation } from "./reading-conversation";

describe("buildReadingConversation", () => {
  it("maps ask roles and skips system rows", () => {
    const result = buildReadingConversation({
      chatMessages: [
        {
          mode: "ask",
          role: "user",
          content: "How are you?",
          createdAt: "2026-02-20T00:00:00.000Z",
          threadId: "t1"
        },
        {
          mode: "ask",
          role: "assistant",
          content: "I am fine.",
          createdAt: "2026-02-20T00:00:01.000Z",
          threadId: "t1"
        },
        {
          mode: "ask",
          role: "system",
          content: "ignore",
          createdAt: "2026-02-20T00:00:02.000Z",
          threadId: "t1"
        }
      ],
      flashcards: [],
      flashcardReviews: [],
      maxChars: 1000
    });

    expect(result.turns).toEqual([
      { role: "user", text: "How are you?" },
      { role: "model", text: "I am fine." }
    ]);
    expect(result.stats.askCount).toBe(2);
  });

  it("pairs translate turns as user->assistant only", () => {
    const result = buildReadingConversation({
      chatMessages: [
        {
          mode: "translate",
          role: "user",
          content: "原文A",
          createdAt: "2026-02-20T00:00:00.000Z",
          threadId: "t1"
        },
        {
          mode: "translate",
          role: "assistant",
          content: "outputA",
          createdAt: "2026-02-20T00:00:01.000Z",
          threadId: "t1"
        },
        {
          mode: "translate",
          role: "user",
          content: "原文B",
          createdAt: "2026-02-20T00:00:02.000Z",
          threadId: "t1"
        }
      ],
      flashcards: [],
      flashcardReviews: [],
      maxChars: 1000
    });

    expect(result.turns).toEqual([
      { role: "user", text: "翻訳して\n原文A" },
      { role: "model", text: "outputA" }
    ]);
    expect(result.stats.translatePairCount).toBe(1);
    expect(result.usedNewTargets).toEqual(["原文A"]);
  });

  it("uses unmastered flashcards by latest review quality and includes never-reviewed cards", () => {
    const result = buildReadingConversation({
      chatMessages: [],
      flashcards: [
        { id: "a", en: "A", ja: "JA", createdAt: "2026-02-20T00:00:00.000Z" },
        { id: "b", en: "B", ja: "JB", createdAt: "2026-02-20T00:00:00.000Z" },
        { id: "c", en: "C", ja: "JC", createdAt: "2026-02-20T00:00:00.000Z" }
      ],
      flashcardReviews: [
        { flashcardId: "a", quality: 2, reviewedAt: "2026-02-21T00:00:00.000Z" },
        { flashcardId: "b", quality: 4, reviewedAt: "2026-02-21T00:00:00.000Z" }
      ],
      maxChars: 1000
    });

    expect(result.turns).toEqual([
      { role: "user", text: "翻訳して\nJC" },
      { role: "model", text: "C" },
      { role: "user", text: "翻訳して\nJA" },
      { role: "model", text: "A" }
    ]);
    expect(result.usedReviewTargets).toEqual(["C", "A"]);
    expect(result.stats.flashcardPairCount).toBe(2);
  });

  it("merges ask/translate/flashcard events by created_at", () => {
    const result = buildReadingConversation({
      chatMessages: [
        {
          mode: "ask",
          role: "user",
          content: "ask-old",
          createdAt: "2026-02-20T00:00:00.000Z",
          threadId: "ask1"
        },
        {
          mode: "translate",
          role: "user",
          content: "trans",
          createdAt: "2026-02-20T00:00:10.000Z",
          threadId: "t1"
        },
        {
          mode: "translate",
          role: "assistant",
          content: "trans-out",
          createdAt: "2026-02-20T00:00:11.000Z",
          threadId: "t1"
        }
      ],
      flashcards: [{ id: "f", en: "flash-en", ja: "flash-ja", createdAt: "2026-02-20T00:00:05.000Z" }],
      flashcardReviews: [],
      maxChars: 1000
    });

    expect(result.turns).toEqual([
      { role: "user", text: "ask-old" },
      { role: "user", text: "翻訳して\nflash-ja" },
      { role: "model", text: "flash-en" },
      { role: "user", text: "翻訳して\ntrans" },
      { role: "model", text: "trans-out" }
    ]);
  });

  it("trims oldest events first when maxChars is exceeded", () => {
    const result = buildReadingConversation({
      chatMessages: [
        {
          mode: "ask",
          role: "user",
          content: "0123456789",
          createdAt: "2026-02-20T00:00:00.000Z",
          threadId: "ask1"
        },
        {
          mode: "ask",
          role: "assistant",
          content: "newest",
          createdAt: "2026-02-20T00:00:01.000Z",
          threadId: "ask1"
        }
      ],
      flashcards: [],
      flashcardReviews: [],
      maxChars: 6
    });

    expect(result.turns).toEqual([{ role: "model", text: "newest" }]);
    expect(result.stats.trimmedCount).toBe(1);
    expect(result.stats.contextChars).toBe(6);
  });

  it("returns empty turns for empty inputs", () => {
    const result = buildReadingConversation({
      chatMessages: [],
      flashcards: [],
      flashcardReviews: [],
      maxChars: 32000
    });

    expect(result.turns).toEqual([]);
    expect(result.stats).toEqual({
      askCount: 0,
      translatePairCount: 0,
      flashcardPairCount: 0,
      trimmedCount: 0,
      contextChars: 0,
      totalEvents: 0
    });
  });
});
