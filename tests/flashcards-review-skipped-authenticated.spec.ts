import { expect, test } from "@playwright/test";

test("does not show an error when review submit is skipped for a missing card", async ({ page }) => {
  const queuePayload = {
    queue: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        en: "I need to head out now.",
        ja: "もう出ないといけない。",
        nextReviewAt: null,
        isDue: true
      }
    ],
    total: 1,
    nextDueAt: "2099-01-01T00:00:00.000Z"
  };

  await page.route("**/api/flashcards/review", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(queuePayload)
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        skipped: true,
        flashcardId: queuePayload.queue[0].id,
        nextDueAt: queuePayload.nextDueAt
      })
    });
  });

  await page.goto("/flashcards");

  const reviewPanel = page.locator("section.panel").first();
  await expect(reviewPanel.getByRole("heading", { name: "フラッシュカード復習" })).toBeVisible();

  await reviewPanel.getByRole("button", { name: "答えを見る" }).click();
  await reviewPanel.getByRole("button", { name: "覚えている" }).click();

  await expect(reviewPanel.getByText("今日の復習は完了です！")).toBeVisible();
  await expect(reviewPanel.getByText("Flashcard not found")).toHaveCount(0);
  await expect(reviewPanel.getByRole("button", { name: "再送" })).toHaveCount(0);
});
