import { expect, test } from "@playwright/test";

const authFile = "tests/.auth/user.json";

test("authenticate with Google and save storage state", async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto("/");

  const loggedInEntryPoint = page.getByRole("link", { name: "音読ページへ" });
  if (await loggedInEntryPoint.isVisible()) {
    await page.context().storageState({ path: authFile });
    return;
  }

  await page.getByRole("button", { name: "Googleでログイン" }).click();

  // Manual step: complete Google OAuth in the opened browser window.
  await expect(loggedInEntryPoint).toBeVisible({ timeout: 180_000 });
  await page.context().storageState({ path: authFile });
});
