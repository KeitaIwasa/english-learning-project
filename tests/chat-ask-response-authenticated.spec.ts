import { expect, test } from "@playwright/test";

test("authenticated user can get ask response text", async ({ page }) => {
  await page.goto("/chat");

  const assistantBubbles = page.locator("article.bubble.assistant");
  const beforeCount = await assistantBubbles.count();

  await page.locator("textarea").fill("cuteとprettyの違いを短く説明して");
  await page.getByRole("button", { name: "送信" }).click();

  await page.waitForFunction(
    (previousCount) => {
      const nodes = Array.from(document.querySelectorAll("article.bubble.assistant"));
      if (nodes.length <= previousCount) {
        return false;
      }

      const lastText = (nodes.at(-1)?.textContent ?? "").trim();
      if (!lastText) {
        return false;
      }

      if (lastText.includes("考え中...")) {
        return false;
      }

      if (lastText.includes("応答を取得できませんでした。")) {
        return false;
      }

      if (lastText.startsWith("エラー:")) {
        return false;
      }

      return true;
    },
    beforeCount,
    { timeout: 120_000 }
  );

  const finalCount = await assistantBubbles.count();
  const finalText = (await assistantBubbles.nth(finalCount - 1).innerText()).trim();
  expect(finalText.length).toBeGreaterThan(0);
  expect(finalText).not.toContain("応答を取得できませんでした。");
  expect(finalText.startsWith("エラー:")).toBe(false);
});
