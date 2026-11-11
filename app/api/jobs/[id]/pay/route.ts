import { route } from '@/lib/context';
import { payJobs } from '@/lib/flows';

// POST /api/jobs/{id}/pay: pays one verified job through PayPal Payouts, if the money rules allow it.
// Body { override: true } is the operator approving a job that needed review.
export const POST = route('Pay now', async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { override?: boolean };
  const [result] = await payJobs([id], { operatorOverride: Boolean(body.override) });
  if (!result) return Response.json({ error: 'No such job.' }, { status: 404 });
  return Response.json(result);
});
