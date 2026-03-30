const path = require('node:path');
const { chromium } = require('@playwright/test');

const baseURL = 'https://web-peach-seven-21.vercel.app';
const storageState = '/tmp/prod-auth.json';
const targetFile = '/home/keita/english-learning-project/2026-03-29 20-38-38.mp3';
const fileName = path.basename(targetFile);
const pollMs = 10000;
const timeoutMs = 20 * 60 * 1000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const failures = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/native-fixer') && !url.includes('storage.googleapis.com')) return;
    if (response.status() >= 400) {
      let body = '';
      try {
        body = await response.text();
      } catch {}
      failures.push({ url, status: response.status(), body: body.slice(0, 500) });
    }
  });

  await page.goto(`${baseURL}/native-fixer`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const loginRequired = await page.getByText('ログイン後に利用できます。').isVisible().catch(() => false);
  if (loginRequired) throw new Error('login required');

  const input = page.locator('.nfx-upload input[type="file"]');
  await input.setInputFiles(targetFile);

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

  const start = Date.now();
  let detail = null;
  while (Date.now() - start < timeoutMs) {
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

  await page.screenshot({ path: '/tmp/native-fixer-prod-test.png', fullPage: true });
  console.log(JSON.stringify({
    fileName,
    jobId: created.id,
    finalStatus: detail?.status || 'timeout',
    errorMessage: detail?.errorMessage || null,
    transcriptLength: detail?.transcriptFull?.length || 0,
    stats: detail?.stats || null,
    failures,
    screenshot: '/tmp/native-fixer-prod-test.png'
  }, null, 2));

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
