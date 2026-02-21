import { expect, test } from "@playwright/test";

test("chat page requires login and does not call /api/chat", async ({ page }) => {
  let calledChatApi = false;

  page.on("request", (request) => {
    if (request.url().includes("/api/chat")) {
      calledChatApi = true;
    }
  });

  await page.goto("/chat");

  await expect(page.getByText("ログイン後に利用できます。")).toBeVisible();
  await expect(page.getByRole("button", { name: "送信" })).toHaveCount(0);
  expect(calledChatApi).toBe(false);
});
