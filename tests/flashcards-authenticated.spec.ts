import { expect, test } from "@playwright/test";

test("authenticated user can add flashcard and see it in recent list", async ({ page }) => {
  const marker = `pw-marker-${Date.now()}`;
  let apiStatus: number | null = null;
  let apiBody = "";

  page.on("response", async (response) => {
    if (response.url().includes("/api/flashcards") && response.request().method() === "POST") {
      apiStatus = response.status();
      apiBody = await response.text().catch(() => "");
    }
  });

  await page.goto("/flashcards");
  await expect(page.getByRole("heading", { name: "フラッシュカード追加" })).toBeVisible();

  await page.locator('textarea[name="en"]').fill(`This is ${marker}.`);
  await page.locator('textarea[name="ja"]').fill(`これは ${marker} です。`);
  await page.getByRole("button", { name: "追加" }).click();

  await page.waitForURL("**/flashcards");
  const recentText = await page.locator("section.panel").nth(1).innerText();

  console.log(`[flashcards-test] apiStatus=${apiStatus}`);
  console.log(`[flashcards-test] apiBody=${apiBody.slice(0, 400)}`);
  console.log(`[flashcards-test] recentPanel=${recentText.slice(0, 800)}`);

  await expect(page.locator("section.panel").nth(1)).toContainText(`This is ${marker}.`);
});
