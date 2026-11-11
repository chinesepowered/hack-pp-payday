// Records real runs of the app for the demo video with Playwright (headless Chromium, recordVideo).
// Run against a production server in Live mode: pnpm build && pnpm start, then
//   node demo/record.mjs worker | dashboard | ops
// Each run writes demo/raw/<name>.webm and demo/raw/<name>.json (marker times in seconds), which
// demo/compose.mjs cuts into scenes.
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Playwright is installed globally in the build environment; `require` finds it there.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const RAW = 'demo/raw';
const which = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(name, viewport, scale, run) {
  const browser = await chromium.launch();
  const size = { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, recordVideo: { dir: `${RAW}/tmp-${name}`, size } });
  await context.addCookies([{ name: 'payday_sid', value: `video-${name}`, url: BASE }, { name: 'payday_mode', value: 'live', url: BASE }]);
  const page = await context.newPage();
  const started = Date.now();
  const marks = {};
  const mark = (key) => {
    marks[key] = (Date.now() - started) / 1000;
    console.log(`  ${key} @ ${marks[key].toFixed(1)}s`);
  };
  try {
    await run(page, mark);
  } finally {
    const video = page.video();
    await context.close();
    await fs.rename(await video.path(), `${RAW}/${name}.webm`);
    await fs.rm(`${RAW}/tmp-${name}`, { recursive: true, force: true });
    await fs.writeFile(`${RAW}/${name}.json`, JSON.stringify(marks, null, 1));
    await browser.close();
  }
}

// A visible cursor, so clicks read on video.
const cursor = async (page) => {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;background:rgba(245,158,11,.55);border:2px solid #b45309;pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;transition:left .25s ease-out,top .25s ease-out';
      document.body.appendChild(dot);
      window.addEventListener('mousemove', (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      }, true);
    });
  });
};

async function click(page, selector, pause = 500) {
  const el = typeof selector === 'string' ? page.locator(selector).first() : selector;
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await sleep(350);
  await el.click();
  await sleep(pause);
}

/** Waits until the auditor has finished: Studio's Stop button has appeared and then stayed away for a while. */
async function auditorDone(page, timeout = 180_000) {
  const stop = page.getByText('Stop', { exact: true });
  const t0 = Date.now();
  let seen = false;
  let quietSince = 0;
  while (Date.now() - t0 < timeout) {
    const running = await stop.first().isVisible().catch(() => false);
    if (running) {
      seen = true;
      quietSince = 0;
    } else if (seen) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince > 3000) return true;
    } else if (Date.now() - t0 > 20_000) return false;
    await sleep(400);
  }
  return false;
}

const runs = {
  // Scenes 3 to 6: the worker finishes a job, AI verifies, PayPal pays; then a job that needs review.
  worker: () =>
    session('worker', { width: 400, height: 720 }, 1.5, async (page, mark) => {
      await cursor(page);
      await page.goto(`${BASE}/worker`, { waitUntil: 'networkidle' });
      await sleep(1500);
      mark('start');
      await click(page, '[data-testid=open-J-4001]', 900);
      for (const box of await page.locator('[data-testid=job-J-4001] input[type=checkbox]').all()) await click(page, box, 250);
      await sleep(700);
      mark('submit');
      await click(page, '[data-testid=submit-J-4001]', 200);
      await page.waitForSelector('[data-testid=step-ai][data-state=done]', { timeout: 60_000 });
      mark('verified');
      await page.waitForSelector('[data-testid=step-pay][data-state=done]', { timeout: 60_000 });
      mark('accepted');
      await page.waitForSelector('[data-testid=paid-card]', { timeout: 150_000 });
      mark('paid');
      await sleep(5500);
      mark('hoodOpen');
      await click(page, '[data-testid=open-hood]', 5500);
      mark('hoodClose');
      await page.keyboard.press('Escape');
      await sleep(700);
      await click(page, '[data-testid=open-J-4002]', 900);
      for (const box of await page.locator('[data-testid=job-J-4002] input[type=checkbox]').all()) await click(page, box, 200);
      mark('submit2');
      await click(page, '[data-testid=submit-J-4002]', 200);
      await page.waitForSelector('[data-testid=review-card]', { timeout: 60_000 });
      mark('review');
      await sleep(1200);
      await page.locator('[data-testid=flow-card] details').first().scrollIntoViewIfNeeded();
      await sleep(5000);
      mark('end');
    }),

  // Scenes 7 to 9: the AG Studio dashboard, the auditor explaining the spike, cancelling the unclaimed item.
  dashboard: () =>
    session('dashboard', { width: 1536, height: 864 }, 1, async (page, mark) => {
      await cursor(page);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      await sleep(3500);
      mark('start');
      await page.mouse.move(520, 420, { steps: 10 });
      await page.mouse.wheel(0, 420);
      await sleep(2200);
      await page.mouse.wheel(0, -420);
      await sleep(800);
      await click(page, '[data-testid=preset-risk]', 2600);
      await click(page, '[data-testid=preset-workers]', 2600);
      await click(page, '[data-testid=preset-overview]', 1500);
      mark('auditorOpen');
      await click(page, '[data-testid=ask-auditor]', 2500);
      mark('ask1');
      await click(page, page.getByText('Why did payouts spike on Tuesday?').first(), 300);
      console.log('  auditor finished:', await auditorDone(page));
      mark('answer1');
      await sleep(7000);
      mark('ask2');
      await click(page, page.getByText('New', { exact: true }).last(), 1500);
      await click(page, page.getByText('Unclaimed payouts', { exact: true }).first(), 300);
      console.log('  auditor finished:', await auditorDone(page));
      mark('answer2');
      await sleep(4000);
      const approve = page.locator('[data-testid=widget-unclaimed-actions] [data-testid=approve-unclaimed_aging]').first();
      await approve.scrollIntoViewIfNeeded();
      await sleep(1200);
      mark('cancel');
      await click(page, approve, 200);
      // PayPal decides how this ends: the item is cancelled, or the sandbox refuses and the card says so.
      const widget = page.locator('[data-testid=widget-unclaimed-actions]');
      const outcome = await Promise.race([
        widget.locator('[data-testid=anomaly-resolution]').first().waitFor({ timeout: 60_000 }).then(() => 'cancelled'),
        widget.locator('[role=alert]').first().waitFor({ timeout: 60_000 }).then(() => 'refused'),
      ]);
      mark(outcome);
      if (outcome === 'refused') {
        await widget.locator('[role=alert]').first().scrollIntoViewIfNeeded();
        await sleep(4500);
        mark('holdInstead');
        await click(page, widget.getByRole('button', { name: 'Hold next payout' }).first(), 300);
        await widget.locator('[data-testid=anomaly-resolution]').first().waitFor({ timeout: 30_000 });
        await widget.locator('[data-testid=anomaly-resolution]').first().scrollIntoViewIfNeeded();
        mark('held');
      }
      await sleep(3500);
      mark('hoodOpen');
      await click(page, '[data-testid=open-hood]', 4500);
      mark('end');
    }),

  // Scenes 10 and 11: the payouts desk (rules, operator approval) and reconciliation.
  ops: () =>
    session('ops', { width: 1536, height: 864 }, 1, async (page, mark) => {
      await cursor(page);
      await page.goto(`${BASE}/ops`, { waitUntil: 'networkidle' });
      await sleep(2500);
      mark('start');
      const hold = page.locator('[data-testid=anomaly-card][data-kind=overpayment] [data-testid=approve-overpayment]').first();
      await hold.scrollIntoViewIfNeeded();
      await sleep(2500);
      mark('hold');
      await click(page, hold, 2500);
      await page.locator('[data-testid=hold-row]').first().scrollIntoViewIfNeeded();
      await sleep(2500);
      mark('approvePay');
      await click(page, '[data-testid=approve-and-pay]', 4500);
      mark('reconcile');
      await click(page, '[data-testid=reconcile]', 1500);
      await page.waitForSelector('[data-testid=recon-panel]', { timeout: 60_000 });
      await page.locator('[data-testid=recon-panel]').scrollIntoViewIfNeeded();
      mark('reconciled');
      await sleep(7000);
      mark('end');
    }),
};

await fs.mkdir(RAW, { recursive: true });
if (!runs[which]) {
  console.error('Usage: node demo/record.mjs worker | dashboard | ops');
  process.exit(1);
}
console.log(`Recording ${which} from ${BASE}`);
await runs[which]();
console.log(`Wrote ${path.join(RAW, `${which}.webm`)}`);
