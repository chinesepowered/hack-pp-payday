import { rateLimit } from '@/lib/ai';
import { route } from '@/lib/context';
import { verifyJob } from '@/lib/flows';

// POST /api/jobs/{id}/submit: the worker submits the checklist and photos; the AI checks the evidence.
export const POST = route('Verify job', async (req, { params }: { params: Promise<{ id: string }> }) => {
  const limited = rateLimit(req, 20);
  if (limited) return limited;
  const { id } = await params;
  return Response.json({ job: await verifyJob(id) });
});
