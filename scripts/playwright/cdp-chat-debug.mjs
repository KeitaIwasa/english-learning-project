import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";

const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const outDir = path.resolve(`tests/screenshots/cdp-debug-${Date.now()}`);
const authFile = path.resolve("tests/.auth/user.json");

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await connectWithFallback();
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

async function connectWithFallback() {
  const winHost = findWindowsHostFromIpRoute();
  const urls = Array.from(
    new Set([process.env.PW_CDP_URL, winHost ? `http://${winHost}:9223` : null, "http://127.0.0.1:9222"].filter(Boolean))
  );

  let lastError;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        console.log(`[cdp-chat-debug] Connecting to ${url} attempt=${attempt}`);
        return await chromium.connectOverCDP(url);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await delay(500);
        }
      }
    }
  }

  throw lastError ?? new Error("Failed to connect CDP");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  console.error(`[cdp-chat-debug] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
