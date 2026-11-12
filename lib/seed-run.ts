// Creates (or re-reads) this build's real sandbox data. Idempotent: PayPal ids are recorded, so a
// second run re-reads statuses instead of paying again. Used by `pnpm seed` and the admin reset.

import { setFeature } from './context';
import { freshState, resetState, runWatchdog } from './flows';
import { createCapturedOrder, createPayoutBatch, getPayoutBatch, type PayPalPayoutItem } from './paypal';
import { buildSeedState, manualBatchPlan } from './seed-data';
import { readSeedRecord, writeSeedRecord, type SeedItem, type SeedRecord } from './seed-live';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 14);

function absorb(target: SeedItem, item: PayPalPayoutItem) {
  target.itemId = item.payout_item_id;
  target.status = item.transaction_status;
  target.transactionId = item.transaction_id;
  target.fee = Number(item.payout_item_fee?.value ?? 0);
  if (item.time_processed) target.completedAt = item.time_processed;
}

async function sendBatch(record: SeedRecord, keys: string[], log: (line: string) => void) {
  const id = stamp();
  const plan = manualBatchPlan().filter((p) => keys.includes(p.key));
  const items: SeedItem[] = plan.map((p) => ({
    key: p.key,
    senderItemId: `SEED-${p.key.toUpperCase()}-${id}`,
    jobId: p.jobId,
    workerId: p.workerId,
    email: p.email,
    amount: p.amount,
    createdAt: new Date().toISOString(),
    batchId: '',
  }));
  const batch = await createPayoutBatch(
    `payday-seed-${id}`,
    plan.map((p, i) => ({ senderItemId: items[i].senderItemId, email: p.email, amount: p.amount, note: p.note })),
  );
  for (const item of items) item.batchId = batch.batch_header.payout_batch_id;
  record.items.push(...items);
  const total = plan.reduce((s, p) => s + p.amount, 0).toFixed(2);
  log(`Created payout batch ${batch.batch_header.payout_batch_id} with ${items.length} item(s), $${total} in total.`);
}

async function refresh(record: SeedRecord, waitForSettle: boolean, log: (line: string) => void) {
  for (let attempt = 0; attempt < (waitForSettle ? 30 : 1); attempt++) {
    for (const batchId of new Set(record.items.map((i) => i.batchId))) {
      const batch = await getPayoutBatch(batchId);
      for (const item of batch.items ?? []) {
        const target = record.items.find((i) => i.senderItemId === item.payout_item.sender_item_id);
        if (target) absorb(target, item);
      }
    }
    if (!record.items.some((i) => !i.status || i.status === 'PENDING')) return;
    if (waitForSettle) {
      log('Payouts still PENDING in the sandbox, polling again in 4 s.');
      await sleep(4000);
    }
  }
}

export async function ensureLiveSeed(log: (line: string) => void = () => {}): Promise<SeedRecord> {
  setFeature('Seed');
  const record = await readSeedRecord();
  if (!record.items.length) {
    record.createdAt = new Date().toISOString();
    record.emailChangedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await sendBatch(record, ['a', 'b', 'c', 'd', 'e'], log);
    await writeSeedRecord(record);
  } else log(`Found ${record.items.length} seeded payout item(s); re-reading them from PayPal.`);
  await refresh(record, true, log);

  // The demo needs one live UNCLAIMED payout to cancel. If the last one was cancelled, send another.
  const latestTypo = record.items.filter((i) => i.key === 'd').at(-1);
  if (latestTypo && latestTypo.status !== 'UNCLAIMED' && latestTypo.status !== 'PENDING') {
    // Only the newest mistyped payout is kept in the demo state.
    record.items = record.items.filter((i) => i.key !== 'd');
    await sendBatch(record, ['d'], log);
    await refresh(record, true, log);
  }

  // Money in: the customers' payments for this morning's jobs (Orders API, sandbox test card).
  const jobs = buildSeedState().jobs.filter((j) => /^J-300\d$/.test(j.id));
  for (const job of jobs) {
    if (record.orders.some((o) => o.jobId === job.id)) continue;
    const order = await createCapturedOrder(`seed-${job.id}-${stamp()}`, job.customerPrice, `TidyNest ${job.type.toLowerCase()}`);
    record.orders.push({ id: order.id, jobId: job.id, amount: order.amount, fee: order.fee, status: order.status, capturedAt: new Date().toISOString() });
    log(`Captured order ${order.id} for ${job.id}: $${order.amount.toFixed(2)} (fee $${order.fee.toFixed(2)}).`);
  }
  await writeSeedRecord(record);
  return record;
}

/** Restores the seeded demo state. `live` also re-reads PayPal and tops up the unclaimed payout. */
export async function resetDemo(opts: { live: boolean; explain?: boolean }, log: (line: string) => void = () => {}) {
  if (opts.live) await ensureLiveSeed(log);
  const state = await freshState();
  await resetState(state); // the one deliberate whole-state overwrite
  const anomalies = await runWatchdog({ explain: opts.explain !== false });
  return { state: { ...state, anomalies }, anomalies };
}
