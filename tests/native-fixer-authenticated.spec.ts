import { expect, test } from "@playwright/test";

const NATIVE_FIXER_AUDIO_FILE = process.env.NATIVE_FIXER_AUDIO_FILE ?? "/home/keita/english-learning-project/2026-02-26 23-20-37.mp3";

test("authenticated user can open native fixer page", async ({ page }) => {
  await page.goto("/native-fixer");

  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "解析履歴" })).toBeVisible();
  await expect(page.getByText("音声ファイルをアップロード")).toBeVisible();
  await expect(page.getByText("MP3 / WAV / AAC / M4A（最大250MB）")).toBeVisible();
  await expect(page.getByRole("button", { name: "新規追加" })).toHaveCount(0);
  await expect(page.locator(".nfx-result")).toHaveCount(0);
});

test("authenticated user can toggle history dropdown on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/native-fixer");

  const historyPanel = page.locator("#nfx-history-panel");
  const toggleButton = page.locator(".nfx-history-toggle");

  await expect(toggleButton).toBeVisible();
  await expect(toggleButton).toHaveAttribute("aria-expanded", "false");
  await expect(historyPanel).not.toHaveClass(/open/);

  await toggleButton.click();
  await expect(toggleButton).toHaveAttribute("aria-expanded", "true");
  await expect(historyPanel).toHaveClass(/open/);
});

test("authenticated user can toggle between history and create mode", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto("/native-fixer");

  const fileInput = page.locator('.nfx-upload input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles(NATIVE_FIXER_AUDIO_FILE);

  await expect(page.getByText("Error:音声アップロードに失敗しました: 400")).toHaveCount(0);
  await expect(page.getByText("Error:音声アップロードに失敗しました")).toHaveCount(0);

  await page.waitForFunction(
    ({ fileName }) => {
      const rows = Array.from(document.querySelectorAll(".nfx-history-item"));
      if (rows.length === 0) return false;
      return rows.some((row) => (row.textContent ?? "").includes(fileName));
    },
    { fileName: NATIVE_FIXER_AUDIO_FILE.split("/").pop() ?? NATIVE_FIXER_AUDIO_FILE },
    { timeout: 4 * 60 * 1000 }
  );

  await page.locator(".nfx-history-item").first().click();
  await expect(page.getByRole("button", { name: "新規追加" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toHaveCount(0);
  await expect(page.getByText("音声ファイルをアップロード")).toHaveCount(0);

  await page.getByRole("button", { name: "新規追加" }).click();
  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toBeVisible();
  await expect(page.getByText("音声ファイルをアップロード")).toBeVisible();
});

test("authenticated user can upload native fixer audio file", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto("/native-fixer");

  const fileInput = page.locator('.nfx-upload input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles(NATIVE_FIXER_AUDIO_FILE);

  await expect(page.getByText("Error:音声アップロードに失敗しました: 400")).toHaveCount(0);
  await expect(page.getByText("Error:音声アップロードに失敗しました")).toHaveCount(0);

  await page.waitForFunction(
    ({ fileName }) => {
      const rows = Array.from(document.querySelectorAll(".nfx-history-item"));
      if (rows.length === 0) return false;
      return rows.some((row) => (row.textContent ?? "").includes(fileName));
    },
    { fileName: NATIVE_FIXER_AUDIO_FILE.split("/").pop() ?? NATIVE_FIXER_AUDIO_FILE },
    { timeout: 4 * 60 * 1000 }
  );

  await expect(page.getByRole("button", { name: "新規追加" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Native English Fixer" })).toHaveCount(0);
  await expect(page.getByText("音声ファイルをアップロード")).toHaveCount(0);
});
