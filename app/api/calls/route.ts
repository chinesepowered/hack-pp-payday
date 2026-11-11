import { modeOf, sessionOf } from '@/lib/context';
import { getDoc, setDoc } from '@/lib/store';
import type { PayPalCall } from '@/lib/types';

// GET /api/calls: every PayPal call this browser session made (for the Under the hood drawer).
export async function GET(req: Request) {
  const calls = (await getDoc<PayPalCall[]>(`calls-${sessionOf(req)}`)) ?? [];
  return Response.json({ calls: calls.slice().reverse(), mode: modeOf(req) });
}

export async function DELETE(req: Request) {
  await setDoc(`calls-${sessionOf(req)}`, []);
  return Response.json({ ok: true });
}
