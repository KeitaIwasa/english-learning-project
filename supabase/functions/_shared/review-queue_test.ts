import { assertEquals } from "jsr:@std/assert";
import { buildReviewQueue, type FlashcardReviewRow, type FlashcardRow } from "./review-queue.ts";

Deno.test("期限前カードのみなら復習キューは空", () => {
  const now = new Date("2026-02-27T12:00:00.000Z");
  const cards: FlashcardRow[] = [
    { id: "c1", en: "A", ja: "あ", created_at: "2026-02-20T00:00:00.000Z" }
  ];
  const reviews: FlashcardReviewRow[] = [
    {
      flashcard_id: "c1",
      repetition: 1,
      interval_days: 1,
      ease_factor: 2.5,
      next_review_at: "2026-03-01T00:00:00.000Z",
      reviewed_at: "2026-02-27T00:00:00.000Z"
    }
  ];

  const result = buildReviewQueue({ cards, reviews, now });

  assertEquals(result.total, 0);
  assertEquals(result.queue, []);
  assertEquals(result.nextDueAt, "2026-03-01T00:00:00.000Z");
});

Deno.test("未レビューカードは復習キューに含まれる", () => {
  const now = new Date("2026-02-27T12:00:00.000Z");
  const cards: FlashcardRow[] = [
    { id: "new-card", en: "Hello", ja: "こんにちは", created_at: "2026-02-27T10:00:00.000Z" }
  ];

  const result = buildReviewQueue({ cards, reviews: [], now });

  assertEquals(result.total, 1);
  assertEquals(result.queue[0]?.id, "new-card");
  assertEquals(result.queue[0]?.isDue, true);
  assertEquals(result.queue[0]?.nextReviewAt, null);
});

Deno.test("期限到来と未レビューだけがキューに入り、期限前は除外される", () => {
  const now = new Date("2026-02-27T12:00:00.000Z");
  const cards: FlashcardRow[] = [
    { id: "due", en: "due", ja: "期限到来", created_at: "2026-02-01T00:00:00.000Z" },
    { id: "not-due", en: "later", ja: "期限前", created_at: "2026-02-02T00:00:00.000Z" },
    { id: "new", en: "new", ja: "未レビュー", created_at: "2026-02-03T00:00:00.000Z" }
  ];
  const reviews: FlashcardReviewRow[] = [
    {
      flashcard_id: "due",
      repetition: 2,
      interval_days: 6,
      ease_factor: 2.5,
      next_review_at: "2026-02-20T00:00:00.000Z",
      reviewed_at: "2026-02-14T00:00:00.000Z"
    },
    {
      flashcard_id: "not-due",
      repetition: 1,
      interval_days: 1,
      ease_factor: 2.5,
      next_review_at: "2026-03-01T00:00:00.000Z",
      reviewed_at: "2026-02-27T00:00:00.000Z"
    }
  ];

  const result = buildReviewQueue({ cards, reviews, now });

  assertEquals(
    result.queue.map((item) => item.id),
    ["new", "due"]
  );
  assertEquals(result.total, 2);
  assertEquals(result.nextDueAt, "2026-03-01T00:00:00.000Z");
});
