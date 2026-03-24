import { expect, test, type Page } from "@playwright/test";

async function addFlashcard(page: Page, en: string, ja: string) {
  await page.locator('textarea[name="en"]').fill(en);
  await page.locator('textarea[name="ja"]').fill(ja);
  await page.getByRole("button", { name: "カードを追加" }).click();
  await page.waitForURL("**/flashcards");
}

test("authenticated user can add/dedupe cards and review one card", async ({ page }) => {
  const marker = `pw-marker-${Date.now()}`;

  await page.goto("/flashcards");
  await expect(page.getByRole("heading", { name: "フラッシュカード追加" })).toBeVisible();

  const enText = `This is ${marker}.`;
  const jaText = `これは ${marker} です。`;

  await addFlashcard(page, enText, jaText);

  await addFlashcard(page, `  This   is ${marker}. `, "重複テスト");

  const recentPanel = page.locator("section.panel").nth(2);
  await expect(recentPanel).toContainText(enText);
  await expect(recentPanel.getByText(new RegExp(`This is ${marker}\\.`))).toHaveCount(1);
  await expect(recentPanel).toContainText("Repetition:");

  const searchInput = recentPanel.getByLabel("検索");
  await searchInput.fill(marker);
  const targetCard = recentPanel.locator(".recent-card").filter({ hasText: marker }).first();
  await expect(targetCard).toBeVisible();

  const updatedEn = `This is updated ${marker}.`;
  const enTextarea = targetCard.getByLabel("English");
  await enTextarea.fill(updatedEn);
  await targetCard.getByLabel("日本語").click();
  await expect(enTextarea).toHaveValue(updatedEn);

  await page.reload();
  const reloadedRecentPanel = page.locator("section.panel").nth(2);
  const reloadedSearchInput = reloadedRecentPanel.getByLabel("検索");
  await reloadedSearchInput.fill(marker);
  const reloadedCard = reloadedRecentPanel.locator(".recent-card").filter({ hasText: marker }).first();
  await expect(reloadedCard).toContainText(updatedEn);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("削除");
    await dialog.accept();
  });
  await reloadedCard.getByRole("button", { name: "削除" }).click();
  await expect(reloadedRecentPanel.locator(".recent-card").filter({ hasText: marker })).toHaveCount(0);

  const reviewPanel = page.locator("section.panel").first();
  await expect(reviewPanel.getByRole("heading", { name: "フラッシュカード復習" })).toBeVisible();

  const showAnswerButton = reviewPanel.getByRole("button", { name: "答えを見る" });
  if (await showAnswerButton.isVisible()) {
    await showAnswerButton.click();
    await expect(reviewPanel.getByRole("button", { name: "覚えている" })).toBeVisible();

    await reviewPanel.getByRole("button", { name: "覚えている" }).click();

    const completedText = reviewPanel.getByText("今日の復習は完了です。");
    if (await completedText.isVisible()) {
      await expect(reviewPanel).toContainText("次回復習予定:");
    } else {
      await expect(reviewPanel).toContainText("進捗:");
    }
  }
});

test("review transitions immediately even if review API is slow", async ({ page }) => {
  const marker = `pw-slow-review-${Date.now()}`;
  await page.goto("/flashcards");

  await addFlashcard(page, `Slow review A ${marker}`, `遅延A ${marker}`);
  await addFlashcard(page, `Slow review B ${marker}`, `遅延B ${marker}`);
  await page.reload();

  const reviewPanel = page.locator("section.panel").first();
  await expect(reviewPanel.getByRole("button", { name: "答えを見る" })).toBeVisible();

  const beforeJa = ((await reviewPanel.locator(".fc-card-ja").first().textContent()) ?? "").trim();
  let delayedOnce = false;
  await page.route("**/api/flashcards/review", async (route) => {
    if (!delayedOnce) {
      delayedOnce = true;
      await page.waitForTimeout(1500);
    }
    await route.continue();
  });

  await reviewPanel.getByRole("button", { name: "答えを見る" }).click();
  await reviewPanel.getByRole("button", { name: "覚えている" }).click();

  await expect
    .poll(
      async () => ((await reviewPanel.locator(".fc-card-ja").first().textContent()) ?? "").trim(),
      { timeout: 500 }
    )
    .not.toBe(beforeJa);
  await page.unroute("**/api/flashcards/review");
});

test("shows retry action when review save fails", async ({ page }) => {
  const marker = `pw-retry-review-${Date.now()}`;
  await page.goto("/flashcards");
  await addFlashcard(page, `Retry review ${marker}`, `再送確認 ${marker}`);
  await page.reload();

  const reviewPanel = page.locator("section.panel").first();
  await expect(reviewPanel.getByRole("button", { name: "答えを見る" })).toBeVisible();

  let failedOnce = false;
  let retried = false;
  await page.route("**/api/flashcards/review", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced error for retry test" })
      });
      return;
    }
    retried = true;
    await route.continue();
  });

  await reviewPanel.getByRole("button", { name: "答えを見る" }).click();
  await reviewPanel.getByRole("button", { name: "覚えている" }).click();

  await expect(reviewPanel.getByRole("alert")).toContainText("forced error for retry test");
  await reviewPanel.getByRole("button", { name: "再送" }).click();
  await expect.poll(() => retried).toBe(true);
  await page.unroute("**/api/flashcards/review");
});
