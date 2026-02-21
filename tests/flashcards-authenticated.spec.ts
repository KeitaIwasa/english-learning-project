import { expect, test } from "@playwright/test";

test("authenticated user can add/dedupe cards and review one card", async ({ page }) => {
  const marker = `pw-marker-${Date.now()}`;

  await page.goto("/flashcards");
  await expect(page.getByRole("heading", { name: "フラッシュカード追加" })).toBeVisible();

  const enText = `This is ${marker}.`;
  const jaText = `これは ${marker} です。`;

  await page.locator('textarea[name="en"]').fill(enText);
  await page.locator('textarea[name="ja"]').fill(jaText);
  await page.getByRole("button", { name: "追加" }).click();
  await page.waitForURL("**/flashcards");

  await page.locator('textarea[name="en"]').fill(`  This   is ${marker}. `);
  await page.locator('textarea[name="ja"]').fill("重複テスト");
  await page.getByRole("button", { name: "追加" }).click();
  await page.waitForURL("**/flashcards");

  const recentPanel = page.locator("section.panel").nth(2);
  await expect(recentPanel).toContainText(enText);
  await expect(recentPanel.getByText(new RegExp(`This is ${marker}\\.`))).toHaveCount(1);

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
