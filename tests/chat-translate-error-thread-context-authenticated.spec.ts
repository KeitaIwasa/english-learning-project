import { expect, test } from "@playwright/test";

test("ask reuses thread id when translate stream ends with error after partial text", async ({ page }) => {
  const threadId = "33333333-3333-4333-8333-333333333333";
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
      const sseBody =
        `event: delta\ndata: ${JSON.stringify({ text: "partial translate" })}\n\n` +
        `event: error\ndata: ${JSON.stringify({ message: "db transient failure", threadId })}\n\n`;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: sseBody
      });
      return;
    }

    expect(body.mode).toBe("ask");
    expect(body.chatId).toBe(threadId);
    const sseBody =
      `event: delta\ndata: ${JSON.stringify({ text: "ask reply" })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ reply: "ask reply", threadId })}\n\n`;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBody
    });
  });

  await page.goto("/chat");

  await page.getByRole("button", { name: "翻訳" }).click();
  await page.locator("textarea").fill("これはテストです");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("partial translate");

  await page.getByRole("button", { name: "質問・添削" }).click();
  await page.locator("textarea").fill("前の翻訳を使って質問します");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("ask reply");

  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[1]?.chatId).toBe(threadId);
});
