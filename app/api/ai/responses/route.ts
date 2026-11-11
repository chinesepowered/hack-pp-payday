import { MODELS, rateLimit } from '@/lib/ai';

// Proxy for AG Studio's OpenAI adapter (app/dashboard/studio/openai-adapter.ts). The adapter runs
// in the browser and POSTs to `${endpoint}/responses`. This route adds the server-side key and
// forwards to the Responses API at OPENAI_BASE_URL (W&B Inference serves it), then streams the
// SSE reply back. Only the configured models may be called, output is capped, and it is rate-limited per IP.

const MAX_OUTPUT_TOKENS = 8000;
const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  const limited = rateLimit(request, 40);
  if (limited) return limited;
  const apiKey = process.env.OPENAI_API_KEY;
  const base = (process.env.OPENAI_BASE_URL ?? '').replace(/\/$/, '');
  if (!apiKey || !base) return error(503, 'The auditor is not configured: set OPENAI_BASE_URL and OPENAI_API_KEY.');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }
  const allowed = [MODELS.text(), MODELS.fallback()];
  const model = typeof body.model === 'string' && allowed.includes(body.model) ? body.model : allowed[0];

  const call = (m: string) =>
    fetch(`${base}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, model: m, max_output_tokens: MAX_OUTPUT_TOKENS }),
      signal: request.signal,
    });

  // About one call in twenty fails upstream: retry, then fall back to the second model.
  let upstream = await call(model);
  for (let i = 0; i < 2 && upstream.status >= 500; i++) upstream = await call(model);
  if (upstream.status >= 500 && model !== MODELS.fallback()) upstream = await call(MODELS.fallback());

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}
