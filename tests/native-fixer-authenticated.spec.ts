import { expect, test } from "@playwright/test";

test("authenticated user can open native fixer page", async ({ page }) => {
  await page.goto("/native-fixer");

  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "解析履歴" })).toBeVisible();
  await expect(page.getByText("音声ファイルをアップロード")).toBeVisible();
  await expect(page.getByText("MP3 / WAV / AAC / M4A（最大250MB）")).toBeVisible();
});

test("authenticated user can upload native fixer audio file", async ({ page }) => {
  await page.goto("/native-fixer");

  const fileInput = page.locator('.nfx-upload input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles("/home/keita/english-learning-project/2026-02-20 23-28-22.mp3");

  await expect(page.getByText("Error:音声アップロードに失敗しました: 400")).toHaveCount(0);
  await expect(page.getByText("Error:音声アップロードに失敗しました")).toHaveCount(0);

  await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll(".nfx-history-item"));
      if (rows.length === 0) return false;
      return rows.some((row) => (row.textContent ?? "").includes("2026-02-20 23-28-22.mp3"));
    },
    undefined,
    { timeout: 30_000 }
  );
});
