import { route } from '@/lib/context';
import { loadState } from '@/lib/flows';
import { getBalances } from '@/lib/paypal';
import { balanceWarning, round2 } from '@/lib/rules';

// GET /api/balance: GET /v1/reporting/balances, plus a warning if paying every verified job would exceed it.
export const GET = route('Balance check', async () => {
  const state = await loadState();
  const queued = round2(state.jobs.filter((j) => j.status === 'verified').reduce((s, j) => s + j.amount, 0));
  try {
    const b = await getBalances();
    const usd = b.balances.find((x) => x.currency === 'USD');
    const available = usd ? Number(usd.available_balance.value) : undefined;
    return Response.json({ available, total: usd ? Number(usd.total_balance.value) : undefined, asOf: b.as_of_time, queued, warning: balanceWarning(queued, available) });
  } catch (e) {
    return Response.json({ queued, error: e instanceof Error ? e.message : 'Balance unavailable' });
  }
});
