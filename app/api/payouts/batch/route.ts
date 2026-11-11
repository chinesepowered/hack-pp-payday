import { route } from '@/lib/context';
import { payJobs } from '@/lib/flows';

// POST /api/payouts/batch: pays several verified jobs in one PayPal payout batch.
export const POST = route('Pay batch', async (req) => {
  const { jobIds } = (await req.json()) as { jobIds: string[] };
  if (!Array.isArray(jobIds) || !jobIds.length || jobIds.length > 20) return Response.json({ error: 'Send 1 to 20 job ids.' }, { status: 400 });
  return Response.json({ results: await payJobs(jobIds) });
});
