import { runWith, sessionOf } from '@/lib/context';
import { resetDemo } from '@/lib/seed-run';

// POST /api/replay/reset: restores the Replay copy of the demo state. Replay never calls PayPal
// or the model: it answers from fixtures/replay.json, recorded from a real sandbox run.
export async function POST(req: Request) {
  await runWith({ sid: sessionOf(req), mode: 'replay', feature: 'Replay reset' }, () => resetDemo({ live: false, explain: true }));
  return Response.json({ ok: true });
}
