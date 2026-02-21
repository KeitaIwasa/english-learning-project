import { describe, expect, it } from "vitest";
import { buildFlashcardReviewQueue } from "./flashcards-review";

describe("buildFlashcardReviewQueue", () => {
  it("places due cards first and then non-due cards by latest created_at", () => {
    const result = buildFlashcardReviewQueue(
      [
        {
          id: "a",
          en: "old due",
          ja: "A",
          createdAt: "2026-02-10T00:00:00.000Z",
          nextReviewAt: "2026-02-20T00:00:00.000Z"
        },
        {
          id: "b",
          en: "new non-due",
          ja: "B",
          createdAt: "2026-02-21T00:00:00.000Z",
          nextReviewAt: "2026-02-23T00:00:00.000Z"
        },
        {
          id: "c",
          en: "older non-due",
          ja: "C",
          createdAt: "2026-02-19T00:00:00.000Z",
          nextReviewAt: "2026-02-24T00:00:00.000Z"
        }
      ],
      "2026-02-21T12:00:00.000Z",
      50
    );

    expect(result.queue.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.queue[0].isDue).toBe(true);
  });

  it("caps queue size to the requested limit", () => {
    const cards = Array.from({ length: 70 }, (_, i) => ({
      id: String(i),
      en: `card-${i}`,
      ja: `カード-${i}`,
      createdAt: `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      nextReviewAt: "2026-03-01T00:00:00.000Z"
    }));

    const result = buildFlashcardReviewQueue(cards, "2026-02-21T12:00:00.000Z", 50);
    expect(result.queue.length).toBe(50);
    expect(result.total).toBe(50);
  });
});
