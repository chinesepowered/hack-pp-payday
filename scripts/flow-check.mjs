// Repeats the worker flow in a real browser and checks that every run reaches the paid card.
// Each run resets the demo (POST /api/admin/reset), opens /worker, submits job J-4001 and waits
// for "Paid". A second tab polls the state the way the payouts desk does, to provoke the
// concurrent-request case. It pays real sandbox money: about $86 per run.
//
//   node --env-file=.env.local scripts/flow-check.mjs 5            five runs, with a polling tab
//   node --env-file=.env.local scripts/flow-check.mjs 1 two-tabs   one run with /worker and /ops open
//   DEMO_URL=https://hack-pp-payday.vercel.app node --env-file=.env.local scripts/flow-check.mjs 2
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const TOKEN = process.env.DEMO_ADMIN_TOKEN;
const runs = Number(process.argv[2] ?? 5);
const twoTabs = process.argv[3] === 'two-tabs';
if (!TOKEN) {
  console.error('DEMO_ADMIN_TOKEN is not set.');
  process.exit(1);
}

const browser = await chromium.launch();
let failures = 0;
for (let run = 1; run <= runs; run++) {
  const started = Date.now();
  const reset = await fetch(`${BASE}/api/admin/reset`, { method: 'POST', headers: { 'x-admin-token': TOKEN } });
  if (!reset.ok) {
    console.log(`run ${run}: reset failed (${reset.status})`);
    failures++;
    continue;
  }
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addCookies([{ name: 'payday_sid', value: `flowcheck-${run}`, url: BASE }, { name: 'payday_mode', value: 'live', url: BASE }]);
  const page = await context.newPage();
  const api = [];
  page.on('response', async (r) => {
    const url = new URL(r.url());
    if (/\/api\/jobs\/.*\/(submit|pay)$/.test(url.pathname)) {
      const body = await r.json().catch(() => ({}));
      api.push(`${url.pathname.split('/').pop()} ${r.status()} ${url.pathname.endsWith('pay') ? `ok=${body.ok} ${(body.blocks ?? []).join(' ')}` : `status=${body.job?.status}`}`);
    }
  });

  // The other tab: the payouts desk, which polls /api/state?refresh=1 (and so reads and saves state).
  const desk = await context.newPage();
  let polls = 0;
  let polling = true;
  if (twoTabs) await desk.goto(`${BASE}/ops`, { waitUntil: 'domcontentloaded' });
  const poller = (async () => {
    while (polling) {
      await context.request.get(`${BASE}/api/state?refresh=${polls % 2 ? 'all' : '1'}`).catch(() => {});
      polls++;
      await new Promise((r) => setTimeout(r, twoTabs ? 2000 : 700));
    }
  })();

  let outcome = 'paid';
  try {
    await page.goto(`${BASE}/worker`, { waitUntil: 'networkidle' });
    await page.click('[data-testid=open-J-4001]');
    await page.click('[data-testid=tick-all-J-4001]');
    await page.click('[data-testid=submit-J-4001]');
    await page.waitForSelector('[data-testid=paid-card]', { timeout: 150_000 });
  } catch {
    outcome = `NOT PAID: ${(await page.locator('[data-testid=flow-card]').innerText().catch(() => 'no flow card')).replace(/\s+/g, ' ').slice(0, 220)}`;
    failures++;
  }
  polling = false;
  await poller;
  const line = outcome === 'paid' ? (await page.locator('[data-testid=paid-card]').innerText()).replace(/\s+/g, ' ').slice(0, 90) : outcome;
  let deskNote = '';
  if (twoTabs) {
    await desk.reload({ waitUntil: 'networkidle' });
    const row = desk.locator('[data-testid=ledger-row]', { hasText: 'J-4001' }).first();
    deskNote = ` | desk ledger: ${(await row.innerText().catch(() => 'J-4001 not in ledger')).replace(/\s+/g, ' ').slice(0, 80)}`;
  }
  console.log(`run ${run}: ${line} | ${api.join(' ; ')} | ${polls} state polls | ${Math.round((Date.now() - started) / 1000)} s${deskNote}`);
  await context.close();
}
await browser.close();
console.log(failures ? `${failures} of ${runs} runs FAILED` : `all ${runs} runs reached the paid card`);
process.exit(failures ? 1 : 0);
