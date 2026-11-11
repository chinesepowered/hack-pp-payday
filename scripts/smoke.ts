// Developer smoke test: runs the main flow against the sandbox (verify, pay, poll) and prints it.
// With RECORD_FIXTURES=1 it also records the responses that Replay mode answers from.
import './env';
import { runWith } from '../lib/context';
import { loadState, payJobs, refreshPayouts, runWatchdog, verifyJob } from '../lib/flows';
import { getBalances, searchTransactions } from '../lib/paypal';
import { toolkitCall } from '../lib/toolkit';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

runWith({ sid: 'smoke', mode: 'live', feature: 'Smoke test' }, async () => {
  const ok = await verifyJob('J-4001');
  console.log('J-4001:', ok.status, ok.verification?.reasons);
  const bad = await verifyJob('J-4002');
  console.log('J-4002:', bad.status, bad.verification?.reasons);
  const [paid] = await payJobs(['J-4001']);
  console.log('pay:', paid.ok, paid.blocks, paid.payout?.batchId);
  const [again] = await payJobs(['J-4001']);
  console.log('pay again (must be blocked):', again.ok, again.blocks);
  for (let i = 0; i < 30 && paid.payout; i++) {
    const state = await refreshPayouts({ payoutId: paid.payout.id });
    const p = state.payouts.find((x) => x.id === paid.payout!.id)!;
    console.log(`  poll ${i}: ${p.status} ${p.secondsToPay ?? ''}`);
    if (p.status !== 'PENDING') break;
    await sleep(3000);
  }
  console.log('balance:', (await getBalances()).balances[0]?.available_balance);
  console.log('txn search items:', (await searchTransactions(new Date(Date.now() - 86_400_000), new Date())).total_items);
  console.log('toolkit list_transactions:', JSON.stringify(await toolkitCall('list_transactions', { start_date: new Date(Date.now() - 86_400_000).toISOString(), end_date: new Date().toISOString() })).slice(0, 200));
  console.log('toolkit insights:', JSON.stringify(await toolkitCall('get_merchant_insights', { start_date: '2026-11-01', end_date: '2026-11-11', insight_type: 'SALES', time_interval: 'DAILY' })).slice(0, 200));
  const anomalies = await runWatchdog();
  console.log('anomalies:', anomalies.length, anomalies.filter((a) => a.ai).length, 'explained');
  console.log('orders:', (await loadState()).orders.filter((o) => o.source === 'live').length);
}).catch((e) => { console.error(e); process.exit(1); });
