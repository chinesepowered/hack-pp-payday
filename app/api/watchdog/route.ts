import { rateLimit } from '@/lib/ai';
import { route } from '@/lib/context';
import { runWatchdog } from '@/lib/flows';

// POST /api/watchdog: runs the rules over every payout and job, then has the model explain new cards.
export const POST = route('Watchdog', async (req) => {
  const limited = rateLimit(req, 12);
  if (limited) return limited;
  return Response.json({ anomalies: await runWatchdog() });
});
