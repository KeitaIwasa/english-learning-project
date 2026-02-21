import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "@playwright/test";

const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const authFile = path.resolve("tests/.auth/user.json");

async function main() {
  const browser = await connectWithFallback();
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No browser context found over CDP. Ensure Chrome is running with --remote-debugging-port.");
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });

  console.log(`[setup-auth-cdp] Opened ${appUrl}`);
  console.log("[setup-auth-cdp] In the Windows Chrome window, complete Google login if needed.");
  if (process.env.PW_AUTO_CONFIRM !== "1") {
    console.log("[setup-auth-cdp] After login is complete, press Enter here to save storageState.");
    const rl = readline.createInterface({ input, output });
    await rl.question("");
    rl.close();
  }

  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await context.storageState({ path: authFile });
  console.log(`[setup-auth-cdp] Saved: ${authFile}`);

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
      console.log(`[setup-auth-cdp] Connecting to ${url}`);
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
  console.error(`[setup-auth-cdp] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
