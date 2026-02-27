import { expect, test } from "@playwright/test";

test("ask sends thread id created by translate so translation history can be used", async ({ page }) => {
  const threadId = "22222222-2222-4222-8222-222222222222";
  const sentBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/chat", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] })
      });
      return;
    }

    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    sentBodies.push(body);

    if (sentBodies.length === 1) {
      expect(body.mode).toBe("translate");
      expect(body.chatId).toBeUndefined();
    }

    if (sentBodies.length === 2) {
      expect(body.mode).toBe("ask");
      expect(body.chatId).toBe(threadId);
    }

    const replyText = sentBodies.length === 1 ? "translate reply" : "ask reply";
    const sseBody =
      `event: delta\ndata: ${JSON.stringify({ text: replyText })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ reply: replyText, threadId })}\n\n`;

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBody
    });
  });

  await page.goto("/chat");

  await page.getByRole("button", { name: "翻訳" }).click();
  await page.locator("textarea").fill("私は犬を飼っています");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("translate reply");

  await page.getByRole("button", { name: "質問・添削" }).click();
  await page.locator("textarea").fill("さっきの英文を丁寧に言うと？");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("ask reply");

  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[1]?.chatId).toBe(threadId);
});
