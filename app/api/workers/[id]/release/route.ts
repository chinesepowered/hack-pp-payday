import { route } from '@/lib/context';
import { releaseHold } from '@/lib/flows';

// POST /api/workers/{id}/release: the operator lifts a payout hold.
export const POST = route('Release hold', async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return Response.json({ worker: await releaseHold(id) });
});
