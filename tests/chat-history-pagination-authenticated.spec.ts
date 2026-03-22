import { expect, test } from "@playwright/test";

test("chat history loads latest 10 first, then loads older messages", async ({ page }) => {
  const firstCursor = "2026-03-01T00:03:00.000Z";
  const getUrls: string[] = [];

  await page.route("**/api/chat**", async (route) => {
    const request = route.request();

    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }

    const url = request.url();
    getUrls.push(url);

    if (url.includes(`before=${encodeURIComponent(firstCursor)}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              thread_id: "t1",
              role: "user",
              mode: "translate",
              content: "msg-01",
              created_at: "2026-03-01T00:01:00.000Z"
            },
            {
              id: "m2",
              thread_id: "t1",
              role: "user",
              mode: "translate",
              content: "msg-02",
              created_at: "2026-03-01T00:02:00.000Z"
            }
          ],
          hasMore: false,
          nextBefore: null
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          {
            id: "m3",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-03",
            created_at: "2026-03-01T00:03:00.000Z"
          },
          {
            id: "m4",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-04",
            created_at: "2026-03-01T00:04:00.000Z"
          },
          {
            id: "m5",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-05",
            created_at: "2026-03-01T00:05:00.000Z"
          },
          {
            id: "m6",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-06",
            created_at: "2026-03-01T00:06:00.000Z"
          },
          {
            id: "m7",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-07",
            created_at: "2026-03-01T00:07:00.000Z"
          },
          {
            id: "m8",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-08",
            created_at: "2026-03-01T00:08:00.000Z"
          },
          {
            id: "m9",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-09",
            created_at: "2026-03-01T00:09:00.000Z"
          },
          {
            id: "m10",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-10",
            created_at: "2026-03-01T00:10:00.000Z"
          },
          {
            id: "m11",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-11",
            created_at: "2026-03-01T00:11:00.000Z"
          },
          {
            id: "m12",
            thread_id: "t1",
            role: "user",
            mode: "translate",
            content: "msg-12",
            created_at: "2026-03-01T00:12:00.000Z"
          }
        ],
        hasMore: true,
        nextBefore: firstCursor
      })
    });
  });

  await page.goto("/chat");

  const userBubbles = page.locator("article.bubble.user");
  await expect(userBubbles).toHaveCount(10);
  await expect(userBubbles.first()).toContainText("msg-03");
  await expect(page.getByRole("button", { name: "さらに読み込む" })).toBeVisible();

  await page.getByRole("button", { name: "さらに読み込む" }).click();

  await expect(userBubbles).toHaveCount(12);
  await expect(userBubbles.first()).toContainText("msg-01");
  await expect(page.getByRole("button", { name: "さらに読み込む" })).toHaveCount(0);

  expect(getUrls).toHaveLength(2);
  expect(getUrls[0]).toContain("limit=10");
  expect(getUrls[1]).toContain("limit=10");
  expect(getUrls[1]).toContain(`before=${encodeURIComponent(firstCursor)}`);
});
