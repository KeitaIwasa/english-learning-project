import path from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";

const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const targetFile = process.env.NFX_FILE ?? "/home/keita/english-learning-project/2026-02-20 23-28-22.mp3";

async function main() {
  const browser = await connectWithFallback();
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const failures = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/storage/v1/object/upload/sign/")) return;
    if (response.status() >= 400) {
      failures.push({
        url: response.url(),
        status: response.status(),
        body: await response.text().catch(() => "")
      });
    }
  });

  await page.goto(`${appBaseUrl}/native-fixer`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  const loginRequired = await page.getByText("ログイン後に利用できます。").isVisible().catch(() => false);
  if (loginRequired) {
    throw new Error("not logged in on CDP Chrome profile");
  }

  const input = page.locator('.nfx-upload input[type="file"]');
  await input.setInputFiles(targetFile);
  await page.waitForTimeout(6000);

  const uploadError = await page.locator(".nfx-error").allInnerTexts();
  const has400Error = uploadError.some((text) => text.includes("400"));
  const hasCreatedHistory = await page
    .locator(".nfx-history-item")
    .filter({ hasText: path.basename(targetFile) })
    .count();

  console.log(
    JSON.stringify(
      {
        loginRequired,
        has400Error,
        uploadError,
        historyCount: hasCreatedHistory,
        failures
      },
      null,
      2
    )
  );

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
        return await chromium.connectOverCDP(url);
      } catch (error) {
        lastError = error;
      }
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
  console.error(`[cdp-native-fixer-upload] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
