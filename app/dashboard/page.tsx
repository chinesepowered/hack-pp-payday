import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { MODELS } from '@/lib/ai';
import { runWith } from '@/lib/context';
import { loadState } from '@/lib/flows';
import { publicState } from '@/lib/view';
import { Dashboard } from './dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  // Live data: rendered per request (cookies() opts out of prerendering).
  const jar = await cookies();
  const mode = jar.get('payday_mode')?.value === 'replay' ? 'replay' : 'live';
  const state = await runWith({ sid: jar.get('payday_sid')?.value ?? 'anon', mode, feature: 'Dashboard' }, () => loadState());

  // Only model ids reach the browser; the key stays on the server (app/api/ai/responses).
  const aiModels = process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL ? [MODELS.text(), MODELS.fallback()] : undefined;
  return <Dashboard initial={publicState(state, mode)} licenseKey={process.env.AG_STUDIO_LICENSE || undefined} aiModels={aiModels} />;
}
