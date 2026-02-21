import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const cdpUrl = process.env.PW_CDP_URL ?? "http://127.0.0.1:9222";
const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const outDir = path.resolve(`tests/screenshots/cdp-debug-${Date.now()}`);
const authFile = path.resolve("tests/.auth/user.json");

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(`${appBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(outDir, "01-home.png"), fullPage: true });

  const loginButton = page.getByRole("button", { name: "Googleでログイン" });
  const homeEntry = page.getByRole("link", { name: "音読ページへ" });
  const loginVisible = await loginButton.isVisible().catch(() => false);
  const entryVisible = await homeEntry.isVisible().catch(() => false);

  console.log(`[cdp-chat-debug] loginButtonVisible=${loginVisible} homeEntryVisible=${entryVisible}`);

  if (loginVisible) {
    await loginButton.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(outDir, "02-after-google-click.png"), fullPage: true });

    await page.waitForURL((url) => url.toString().startsWith(appBaseUrl), { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "03-after-auth-return.png"), fullPage: true });
  }

  await page.goto(`${appBaseUrl}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "04-chat.png"), fullPage: true });

  const chatHeading = await page.getByRole("heading", { name: "学習チャット" }).isVisible().catch(() => false);
  const loginRequired = await page.getByText("ログイン後に利用できます。").isVisible().catch(() => false);
  console.log(`[cdp-chat-debug] chatHeadingVisible=${chatHeading} loginRequiredVisible=${loginRequired}`);

  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
  console.log(`[cdp-chat-debug] storageState saved: ${authFile}`);
  console.log(`[cdp-chat-debug] screenshots: ${outDir}`);

  await browser.close();
}

main().catch((error) => {
  console.error(`[cdp-chat-debug] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
