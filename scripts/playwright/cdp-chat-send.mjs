import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const cdpUrl = process.env.PW_CDP_URL ?? "http://127.0.0.1:9222";
const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const message = process.env.CHAT_MESSAGE ?? "cuteとprettyの違いは？";
const outDir = path.resolve(`tests/screenshots/chat-send-${Date.now()}`);

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(`${appBaseUrl}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, "01-chat-open.png"), fullPage: true });

  const loginRequired = await page.getByText("ログイン後に利用できます。").isVisible().catch(() => false);
  if (loginRequired) {
    console.log("[cdp-chat-send] Not logged in on /chat.");
    console.log(`[cdp-chat-send] screenshots: ${outDir}`);
    await browser.close();
    process.exit(2);
  }

  const textarea = page.locator("textarea");
  await textarea.fill(message);
  await page.screenshot({ path: path.join(outDir, "02-filled-message.png"), fullPage: true });

  await page.getByRole("button", { name: "送信" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "03-after-send.png"), fullPage: true });

  const assistantBubbles = page.locator("article.bubble.assistant p");
  const beforeCount = await assistantBubbles.count();
  await page.waitForFunction(
    (count) => {
      const nodes = document.querySelectorAll("article.bubble.assistant p");
      if (nodes.length > count) return true;
      return Array.from(nodes).some((n) => (n.textContent ?? "").startsWith("エラー:"));
    },
    beforeCount,
    { timeout: 90000 }
  ).catch(() => {});

  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "04-response.png"), fullPage: true });

  const allAssistantTexts = await assistantBubbles.allTextContents();
  const lastAssistantText = allAssistantTexts.at(-1) ?? "";
  console.log(`[cdp-chat-send] lastAssistantText=${lastAssistantText}`);
  console.log(`[cdp-chat-send] screenshots: ${outDir}`);

  await browser.close();
}

main().catch((error) => {
  console.error(`[cdp-chat-send] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
