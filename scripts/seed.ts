// pnpm seed: creates this build's sandbox data through the PayPal API and prints what it made.
// Safe to re-run: existing payouts and orders are re-read, not paid again.
import './env';
import { promises as fs } from 'node:fs';
import { runWith } from '../lib/context';
import { resetDemo } from '../lib/seed-run';
import { readSeedRecord } from '../lib/seed-live';

async function main() {
  const log = (line: string) => console.log(`  ${line}`);
  console.log('Seeding the PayPal sandbox for Payday (TidyNest)');
  const { state, anomalies } = await runWith({ sid: 'seed', mode: 'live', feature: 'Seed' }, () => resetDemo({ live: true }, log));
  const record = await readSeedRecord();
  await fs.writeFile('seed/paypal-seed.json', JSON.stringify(record, null, 1));

  console.log("\nSandbox payouts (the operator's last manual batch, mistakes included):");
  for (const i of record.items)
    console.log(`  ${i.senderItemId}  ${i.jobId}  $${i.amount.toFixed(2).padStart(7)}  ${String(i.status).padEnd(9)}  item ${i.itemId}  to ${i.email}`);
  console.log('\nSandbox orders (customers paying TidyNest):');
  for (const o of record.orders) console.log(`  ${o.id}  ${o.jobId}  $${o.amount.toFixed(2)}  ${o.status}`);
  const imported = state.jobs.filter((j) => j.source === 'imported').length;
  console.log(
    `\nLocal state: ${state.workers.length} workers, ${imported} imported-history jobs, ${state.jobs.length - imported} live jobs, ${state.payouts.length} payouts, ${state.orders.length} orders.`,
  );
  console.log(`Watchdog: ${anomalies.length} anomalies`);
  for (const a of anomalies) console.log(`  [${a.severity}] ${a.title} ($${a.amountAtRisk.toFixed(2)} at risk)${a.ai ? '  AI: ' + a.ai.summary : ''}`);
  console.log('\nRecorded PayPal ids in seed/paypal-seed.json (not secret; commit it so deployments show the same payouts).');
}

main().catch((e) => {
  console.error('Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
