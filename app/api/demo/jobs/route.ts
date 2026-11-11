import { route } from '@/lib/context';
import { addDemoJobs } from '@/lib/flows';

// POST /api/demo/jobs: schedules a fresh set of today's jobs, so the demo never runs dry.
export const POST = route('Demo jobs', async () => Response.json({ jobs: await addDemoJobs() }));
