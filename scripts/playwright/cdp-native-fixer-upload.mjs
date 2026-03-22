import path from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";

const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const targetFile = process.env.NFX_FILE ?? "/home/keita/english-learning-project/2026-02-26 23-20-37.mp3";
const pollMs = Number(process.env.NFX_POLL_MS ?? 10_000);
const timeoutMs = Number(process.env.NFX_TIMEOUT_MS ?? 30 * 60 * 1000);

async function main() {
  const browser = await connectWithFallback();
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const failures = [];
  page.on("response", async (response) => {
    if (!response.url().includes("storage.googleapis.com") && !response.url().includes("/api/native-fixer/jobs")) return;
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

  const uploadFinishedAt = new Date().toISOString();
  const createdJob = await findLatestJob(page, path.basename(targetFile));
  if (!createdJob?.id) {
    throw new Error("uploaded job id not found from /api/native-fixer/jobs");
  }

  const startedAt = Date.now();
  const settled = await waitUntilSettled(page, createdJob.id, {
    timeoutMs,
    pollMs
  });

  const elapsedMs = Date.now() - startedAt;
  const transcriptText = settled.detail?.transcriptFull ?? "";
  const transcriptLines = transcriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const avgLineLength =
    transcriptLines.length > 0
      ? transcriptLines.reduce((sum, line) => sum + line.length, 0) / transcriptLines.length
      : 0;

  console.log(
    JSON.stringify(
      {
        loginRequired,
        targetFile,
        has400Error,
        uploadError,
        historyCount: hasCreatedHistory,
        failures,
        uploadFinishedAt,
        jobId: createdJob.id,
        finalStatus: settled.status,
        elapsedMs,
        stats: settled.detail?.stats ?? null,
        transcriptMetrics: {
          lineCount: transcriptLines.length,
          avgLineLength: Number(avgLineLength.toFixed(2))
        },
        errorMessage: settled.detail?.errorMessage ?? null
      },
      null,
      2
    )
  );

  await browser.close();
}

async function findLatestJob(page, fileName) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/native-fixer/jobs", { method: "GET" });
    const json = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      items: Array.isArray(json?.items) ? json.items : [],
      error: json?.error ?? null
    };
  });

  if (!result.ok) {
    throw new Error(`failed to fetch jobs: ${result.status} ${result.error ?? ""}`.trim());
  }

  const candidates = result.items.filter((item) => item?.fileName === fileName);
  candidates.sort((a, b) => Date.parse(b?.createdAt ?? "") - Date.parse(a?.createdAt ?? ""));
  return candidates[0] ?? null;
}

async function waitUntilSettled(page, jobId, options) {
  const deadline = Date.now() + options.timeoutMs;
  let lastDetail = null;

  while (Date.now() < deadline) {
    const detailRes = await page.evaluate(async (id) => {
      const response = await fetch(`/api/native-fixer/jobs/${id}`, { method: "GET" });
      const json = await response.json().catch(() => ({}));
      return {
        ok: response.ok,
        status: response.status,
        item: json?.item ?? null,
        error: json?.error ?? null
      };
    }, jobId);

    if (!detailRes.ok || !detailRes.item) {
      throw new Error(`failed to fetch job detail: ${detailRes.status} ${detailRes.error ?? ""}`.trim());
    }

    lastDetail = detailRes.item;
    if (lastDetail.status === "completed" || lastDetail.status === "failed") {
      return { status: lastDetail.status, detail: lastDetail };
    }

    await page.waitForTimeout(options.pollMs);
  }

  return { status: "timeout", detail: lastDetail };
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
