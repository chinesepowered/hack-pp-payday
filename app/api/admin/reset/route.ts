import { timingSafeEqual } from 'node:crypto';
import { runWith } from '@/lib/context';
import { resetDemo } from '@/lib/seed-run';

export const maxDuration = 120;

// POST /api/admin/reset (header x-admin-token): restores the seeded demo state, re-reads the seeded
// payouts from PayPal and tops up the unclaimed payout if a judge already cancelled it.
export async function POST(req: Request) {
  const expected = process.env.DEMO_ADMIN_TOKEN ?? '';
  const given = req.headers.get('x-admin-token') ?? '';
  const ok = expected.length > 0 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ error: 'Not authorised.' }, { status: 401 });
  const lines: string[] = [];
  try {
    const { state, anomalies } = await runWith({ sid: 'admin', mode: 'live', feature: 'Admin reset' }, () => resetDemo({ live: true }, (l) => lines.push(l)));
    await runWith({ sid: 'admin', mode: 'replay', feature: 'Admin reset' }, () => resetDemo({ live: false })).catch(() => {});
    return Response.json({ ok: true, jobs: state.jobs.length, payouts: state.payouts.length, anomalies: anomalies.length, log: lines });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Reset failed', log: lines }, { status: 500 });
  }
}
