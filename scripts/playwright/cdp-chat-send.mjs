import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";

const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const message = process.env.CHAT_MESSAGE ?? "cuteとprettyの違いは？";
const outDir = path.resolve(`tests/screenshots/chat-send-${Date.now()}`);

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await connectWithFallback();
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

async function connectWithFallback() {
  const winHost = findWindowsHostFromIpRoute();
  const urls = [process.env.PW_CDP_URL, winHost ? `http://${winHost}:9223` : null, "http://127.0.0.1:9222"].filter(
    Boolean
  );

  let lastError;
  for (const url of urls) {
    try {
      console.log(`[cdp-chat-send] Connecting to ${url}`);
      return await chromium.connectOverCDP(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to connect CDP");
}

function findWindowsHostFromIpRoute() {
  try {
    const output = execSync("ip route", { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const line = output
      .split("\n")
      .map((v) => v.trim())
      .find((v) => v.startsWith("default "));
    const match = line?.match(/\bvia\s+([0-9.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(`[cdp-chat-send] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
