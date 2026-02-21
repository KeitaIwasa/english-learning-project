import { expect, test } from "@playwright/test";

test("authenticated user can open chat composer", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.locator(".chat-shell")).toBeVisible();
  await expect(page.getByPlaceholder("翻訳したい文を入力")).toBeVisible();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
});
