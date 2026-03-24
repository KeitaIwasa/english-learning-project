import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';

const winHost = execSync("ip route | awk '/default/ {print $3; exit}'", { encoding: 'utf8' }).trim();
const browser = await chromium.connectOverCDP(`http://${winHost}:9223`);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());
if (!page.url().includes('aistudio.google.com/app/logs')) {
  await page.goto('https://aistudio.google.com/app/logs?project=gen-lang-client-0926290743', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
}

const rows = await page.evaluate(() => {
  const out = [];
  const trs = Array.from(document.querySelectorAll('table tr'));
  for (const tr of trs) {
    const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim().replace(/\s+/g, ' '));
    if (tds.length >= 6) out.push(tds);
    if (out.length >= 5) break;
  }
  return out;
});

const pageText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const summaryMatch = pageText.match(/1\s*[–-]\s*25\s*of\s*\d+/);

console.log(JSON.stringify({
  url: page.url(),
  summary: summaryMatch ? summaryMatch[0] : null,
  rows
}, null, 2));
await browser.close();
