import { ctx, route } from '@/lib/context';
import { refreshPayouts } from '@/lib/flows';
import { publicState } from '@/lib/view';

// POST /api/payouts/refresh: re-reads payouts from PayPal (GET /v1/payments/payouts/{batch}).
export const POST = route('Refresh status', async (req) => {
  const body = (await req.json().catch(() => ({}))) as { payoutId?: string; all?: boolean };
  return Response.json(publicState(await refreshPayouts(body), ctx().mode));
});
