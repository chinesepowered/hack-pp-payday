import { route } from '@/lib/context';
import { loadState } from '@/lib/flows';
import { searchTransactions } from '@/lib/paypal';

// GET /api/reconcile: compares the payouts Payday recorded with PayPal Transaction Search
// (GET /v1/reporting/transactions). Transaction Search lags the ledger by up to three hours, so a
// payout missing from it is only a concern once it is older than that.
export const GET = route('Reconciliation', async () => {
  const state = await loadState();
  const live = state.payouts.filter((p) => p.source === 'live');
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 86_400_000);
  const search = await searchTransactions(start, end);
  const txns = search.transaction_details ?? [];
  const byId = new Map(txns.map((t) => [t.transaction_info.transaction_id, t]));
  const lagMs = 3 * 3_600_000;
  const rows = live.map((p) => {
    const hit = p.transactionId ? byId.get(p.transactionId) : undefined;
    const age = Date.now() - Date.parse(p.createdAt);
    return {
      payoutId: p.id,
      jobId: p.jobId,
      amount: p.amount,
      status: p.status,
      transactionId: p.transactionId ?? null,
      createdAt: p.createdAt,
      match: hit ? (Math.abs(Math.abs(Number(hit.transaction_info.transaction_amount.value)) - p.amount) < 0.005 ? 'matched' : 'amount differs') : age < lagMs ? 'waiting for Transaction Search' : p.transactionId ? 'missing' : 'no transaction yet',
      ledgerAmount: hit ? Number(hit.transaction_info.transaction_amount.value) : null,
      eventCode: hit?.transaction_info.transaction_event_code ?? null,
    };
  });
  return Response.json({ rows, ledgerCount: txns.length, lastRefreshed: search.last_refreshed_datetime ?? null, window: { start, end } });
});
