import { expect, test } from "@playwright/test";

test("authenticated user can open native fixer page", async ({ page }) => {
  await page.goto("/native-fixer");

  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "解析履歴" })).toBeVisible();
  await expect(page.getByText("音声ファイルをアップロード")).toBeVisible();
  await expect(page.getByText("MP3 / WAV / AAC / M4A（最大250MB）")).toBeVisible();
});
