import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const winHost = execSync("ip route | awk '/default/ {print $3; exit}'", { encoding: 'utf8' }).trim();
const cdp = `http://${winHost}:9223`;
const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());
const dir = '/home/keita/english-learning-project/test-results/cdp';
fs.mkdirSync(dir, { recursive: true });

const shots = [];
async function shot(name) {
  const p = `${dir}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  shots.push(p);
}

await page.goto('https://console.cloud.google.com/iam-admin/audit?project=gen-lang-client-0926290743', {
  waitUntil: 'domcontentloaded',
  timeout: 90000
});
await page.waitForTimeout(5000);
await shot('11-audit-open');

const filterButton = page.getByText('フィルタ', { exact: false }).first();
if (await filterButton.count()) {
  await filterButton.click({ timeout: 10000 });
  await page.waitForTimeout(500);
}

const serviceOption = page.locator('div[role="option"]', { hasText: 'サービス' }).first();
if (await serviceOption.count()) {
  await serviceOption.click({ timeout: 10000 });
  await page.waitForTimeout(500);
}
await shot('12-filter-service-open');

const combo = page.getByRole('combobox').first();
if (await combo.count()) {
  await combo.fill('Generative Language API');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
}
await shot('13-filtered');

const row = page.getByText('Generative Language API', { exact: false }).first();
if (await row.count()) {
  await row.click({ timeout: 10000 });
  await page.waitForTimeout(1500);
}
await shot('14-row-selected');

const dataRead = page.getByText('データ読み取り', { exact: false }).first();
if (await dataRead.count()) {
  await dataRead.click({ timeout: 10000 });
  await page.waitForTimeout(500);
}
await shot('15-data-read-toggled');

const save = page.getByRole('button', { name: '保存' }).first();
if (await save.count()) {
  await save.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
}
await shot('16-saved');

console.log(JSON.stringify({ url: page.url(), shots }, null, 2));
await browser.close();
