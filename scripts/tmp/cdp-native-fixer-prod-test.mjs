import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const baseURL = 'https://web-peach-seven-21.vercel.app';
const targetFile = String.raw`C:\Users\keita\Downloads\2026-03-29 20-38-38.mp3`;
const authStatePath = '/tmp/prod-auth.json';
const fileName = '2026-03-29 20-38-38.mp3';
const pollMs = 10000;
const timeoutMs = 20 * 60 * 1000;

async function main() {
  const browser = await connectWithFallback();
  const context = browser.contexts()[0] ?? await browser.newContext();
  const auth = JSON.parse(await fs.readFile(authStatePath, 'utf8'));
  if (Array.isArray(auth.cookies) && auth.cookies.length > 0) {
    await context.addCookies(auth.cookies);
  }

  const page = context.pages()[0] ?? await context.newPage();
  const failures = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/native-fixer') && !url.includes('storage.googleapis.com')) return;
    if (response.status() >= 400) {
      let body = '';
      try { body = await response.text(); } catch {}
      failures.push({ url, status: response.status(), body: body.slice(0, 500) });
    }
  });

  await page.goto(`${baseURL}/native-fixer`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const loginRequired = await page.getByText('ログイン後に利用できます。').isVisible().catch(() => false);
  if (loginRequired) throw new Error('login required');

  await setRemoteInputFiles(page, '.nfx-upload input[type="file"]', [targetFile]);

  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll('.nfx-history-item')).some((el) => (el.textContent || '').includes(name)),
    fileName,
    { timeout: 4 * 60 * 1000 }
  );

  const jobs = await page.evaluate(async () => {
    const r = await fetch('/api/native-fixer/jobs');
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, items: j.items || [], error: j.error || null };
  });
  if (!jobs.ok) throw new Error(`jobs fetch failed: ${jobs.status} ${jobs.error || ''}`.trim());

  const created = jobs.items
    .filter((item) => item?.fileName === fileName)
    .sort((a, b) => Date.parse(b?.createdAt || '') - Date.parse(a?.createdAt || ''))[0];
  if (!created?.id) throw new Error('created job not found');

  let detail = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`/api/native-fixer/jobs/${id}`);
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, item: j.item || null, error: j.error || null };
    }, created.id);
    if (!res.ok || !res.item) throw new Error(`job detail failed: ${res.status} ${res.error || ''}`.trim());
    detail = res.item;
    if (detail.status === 'completed' || detail.status === 'failed') break;
    await page.waitForTimeout(pollMs);
  }

  await page.screenshot({ path: '/tmp/native-fixer-prod-headed.png', fullPage: true });
  console.log(JSON.stringify({
    fileName,
    jobId: created.id,
    finalStatus: detail?.status || 'timeout',
    errorMessage: detail?.errorMessage || null,
    transcriptLength: detail?.transcriptFull?.length || 0,
    stats: detail?.stats || null,
    failures,
    screenshot: '/tmp/native-fixer-prod-headed.png'
  }, null, 2));
}

async function setRemoteInputFiles(page, selector, files) {
  const client = await page.context().newCDPSession(page);
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector
  });

  if (!nodeId) {
    throw new Error(`file input not found: ${selector}`);
  }

  await client.send('DOM.setFileInputFiles', {
    nodeId,
    files
  });
}

async function connectWithFallback() {
  const winHost = findWindowsHostFromIpRoute();
  const urls = Array.from(new Set([
    process.env.PW_CDP_URL,
    winHost ? `http://${winHost}:9223` : null,
    'http://127.0.0.1:9222'
  ].filter(Boolean)));

  let lastError;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await chromium.connectOverCDP(url);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError ?? new Error('Failed to connect CDP');
}

function findWindowsHostFromIpRoute() {
  try {
    const output = execSync('ip route', { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const line = output.split('\n').map((v) => v.trim()).find((v) => v.startsWith('default '));
    const match = line?.match(/\bvia\s+([0-9.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
