import { route } from '@/lib/context';
import { actOnAnomaly } from '@/lib/flows';
import type { ActionKind } from '@/lib/types';

const ACTIONS = ['hold_next_payout', 'cancel_unclaimed_item', 'message_worker', 'dismiss'];

// POST /api/anomalies/action: the operator approves the suggested action on an anomaly card.
export const POST = route('Anomaly action', async (req) => {
  const { id, action } = (await req.json()) as { id: string; action: ActionKind | 'dismiss' };
  if (!ACTIONS.includes(action)) return Response.json({ error: 'Unknown action.' }, { status: 400 });
  try {
    return Response.json(await actOnAnomaly(id, action));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'The action failed.' }, { status: 409 });
  }
});
