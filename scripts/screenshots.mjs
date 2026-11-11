// Takes the README screenshots (1440x960) from a running app in Live mode:
//   pnpm seed && pnpm build && pnpm start, then node scripts/screenshots.mjs
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const OUT = 'docs/screenshots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await context.addCookies([{ name: 'payday_sid', value: 'screens', url: BASE }, { name: 'payday_mode', value: 'live', url: BASE }]);
const page = await context.newPage();
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png`);
};

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot('01-home');

await page.goto(`${BASE}/worker`, { waitUntil: 'networkidle' });
await page.click('[data-testid=open-J-4001]');
await page.click('[data-testid=tick-all-J-4001]');
await sleep(400);
await shot('02-worker-job');
await page.click('[data-testid=submit-J-4001]');
await page.waitForSelector('[data-testid=paid-card]', { timeout: 150_000 });
await sleep(900);
await shot('03-worker-paid');
await page.click('[data-testid=open-hood]');
await sleep(1500);
await shot('04-under-the-hood');
await page.keyboard.press('Escape');
await page.click('[data-testid=open-J-4002]');
await page.click('[data-testid=tick-all-J-4002]');
await page.click('[data-testid=submit-J-4002]');
await page.waitForSelector('[data-testid=review-card]', { timeout: 60_000 });
await sleep(800);
await shot('05-worker-needs-review');

await page.goto(`${BASE}/ops`, { waitUntil: 'networkidle' });
await sleep(1500);
await shot('06-payouts-desk');
await page.click('[data-testid=reconcile]');
await page.waitForSelector('[data-testid=recon-panel]', { timeout: 60_000 });
await page.locator('[data-testid=recon-panel]').scrollIntoViewIfNeeded();
await sleep(600);
await shot('07-reconciliation');

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await sleep(4000);
await shot('08-dashboard-overview');
await page.click('[data-testid=preset-workers]');
await sleep(2500);
await shot('09-dashboard-workers');
await page.click('[data-testid=preset-risk]');
await sleep(2500);
await shot('10-dashboard-risk');
await page.click('[data-testid=preset-overview]');
await page.click('[data-testid=ask-auditor]');
await sleep(2500);
await page.getByText('Why did payouts spike on Tuesday?').first().click();
const stop = page.getByText('Stop', { exact: true }).first();
await sleep(6000);
for (let i = 0, quiet = 0; i < 300 && quiet < 6; i++) {
  quiet = (await stop.isVisible().catch(() => false)) ? 0 : quiet + 1;
  await sleep(500);
}
await sleep(1000);
await shot('11-auditor-spike');
await browser.close();
