import { ctx, route } from '@/lib/context';
import { loadState, refreshPayouts } from '@/lib/flows';
import { publicState } from '@/lib/view';

// GET /api/state: the app state. With ?refresh=1 pending live payouts are re-read from PayPal first
// (polling, so the app never depends on webhook delivery).
export const GET = route('Refresh status', async (req) => {
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh');
  const state = refresh ? await refreshPayouts({ all: refresh === 'all' }) : await loadState();
  return Response.json(publicState(state, ctx().mode));
});
