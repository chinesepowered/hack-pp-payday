import { rateLimit } from '@/lib/ai';
import { route } from '@/lib/context';
import { loadState, refreshPayouts } from '@/lib/flows';
import { getPayoutItem } from '@/lib/paypal';
import { toolkitCall } from '@/lib/toolkit';

// Server side of the Payout auditor's tools (the agent itself runs in AG Studio's harness in the
// browser; see app/dashboard/studio/auditor.ts). Read-only: nothing here moves money.
export const POST = route('Payout auditor', async (req, { params }: { params: Promise<{ tool: string }> }) => {
  const limited = rateLimit(req, 40);
  if (limited) return limited;
  const { tool } = await params;
  const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (tool === 'paypal_item_status') {
    const state = await loadState();
    const payout = state.payouts.find((p) => p.id === args.payoutId || p.itemId === args.payoutId);
    if (!payout?.itemId) return Response.json({ error: 'That payout is imported history: it has no live PayPal item.' });
    const item = await getPayoutItem(payout.itemId);
    return Response.json({ payoutId: payout.id, itemId: item.payout_item_id, status: item.transaction_status, amount: item.payout_item.amount.value, receiver: item.payout_item.receiver, fee: item.payout_item_fee?.value, processed: item.time_processed });
  }
  if (tool === 'refresh_from_paypal') {
    const state = await refreshPayouts({ all: true });
    return Response.json({ refreshed: state.payouts.filter((p) => p.source === 'live').map((p) => ({ id: p.id, status: p.status, amount: p.amount })) });
  }
  if (tool === 'list_transactions') {
    const end = new Date();
    const start = new Date(end.getTime() - Math.min(Number(args.days) || 3, 30) * 86_400_000);
    const out = await toolkitCall('list_transactions', { start_date: start.toISOString(), end_date: end.toISOString(), transaction_status: 'S' });
    return Response.json({ note: 'PayPal Transaction Search lags the ledger by up to 3 hours.', result: out });
  }
  if (tool === 'get_merchant_insights') {
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 86_400_000);
    const out = await toolkitCall('get_merchant_insights', { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), insight_type: 'SALES', time_interval: 'DAILY' });
    return Response.json({ result: out });
  }
  return Response.json({ error: `Unknown tool ${tool}` }, { status: 404 });
});
