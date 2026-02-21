import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "@playwright/test";

const cdpUrl = process.env.PW_CDP_URL ?? "http://127.0.0.1:9222";
const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const authFile = path.resolve("tests/.auth/user.json");

async function main() {
  console.log(`[setup-auth-cdp] Connecting to ${cdpUrl}`);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No browser context found over CDP. Ensure Chrome is running with --remote-debugging-port.");
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });

  console.log(`[setup-auth-cdp] Opened ${appUrl}`);
  console.log("[setup-auth-cdp] In the Windows Chrome window, complete Google login if needed.");
  console.log("[setup-auth-cdp] After login is complete, press Enter here to save storageState.");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();

  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
  console.log(`[setup-auth-cdp] Saved: ${authFile}`);

  await browser.close();
}

main().catch((error) => {
  console.error(`[setup-auth-cdp] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
