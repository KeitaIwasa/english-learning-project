import { expect, test } from "@playwright/test";

test("ask sends prior thread id so history is included in context", async ({ page }) => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const sentBodies: Array<Record<string, unknown>> = [];
  let firstMessage = "";

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
    const replyText =
      sentBodies.length === 1 ? "first reply" : `context:${firstMessage || String(body.message ?? "")}`;

    if (sentBodies.length === 1) {
      firstMessage = String(body.message ?? "");
      expect(body.chatId).toBeUndefined();
    } else if (sentBodies.length === 2) {
      expect(body.chatId).toBe(threadId);
    }

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

  await page.getByRole("button", { name: "質問・添削" }).click();

  await page.locator("textarea").fill("I has a dog.");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("first reply");

  await page.locator("textarea").fill("もう一回、前の文を使って直して");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator("article.bubble.assistant").last()).toContainText("context:I has a dog.");

  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[1]?.chatId).toBe(threadId);
});
