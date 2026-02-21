import { expect, test } from "@playwright/test";

test("authenticated user can open chat composer", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "学習チャット" })).toBeVisible();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
});
