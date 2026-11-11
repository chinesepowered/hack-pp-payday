// Per-request context: which session is calling, whether it runs live or in Replay mode, which
// feature triggered the PayPal calls, and the calls made so far (for the Under the hood drawer).

import { AsyncLocalStorage } from 'node:async_hooks';
import { getDoc, setDoc } from './store';
import type { PayPalCall } from './types';

export type Mode = 'live' | 'replay';
export type Ctx = { sid: string; mode: Mode; feature: string; calls: PayPalCall[] };

const als = new AsyncLocalStorage<Ctx>();
const fallback: Ctx = { sid: 'system', mode: 'live', feature: 'system', calls: [] };

export const ctx = (): Ctx => als.getStore() ?? fallback;
export const stateKey = (mode: Mode = ctx().mode) => (mode === 'replay' ? 'state-replay' : 'state');

export function setFeature(feature: string) {
  ctx().feature = feature;
}

export function logCall(call: Omit<PayPalCall, 'feature' | 'at'> & { feature?: string }) {
  const c = ctx();
  c.calls.push({ at: new Date().toISOString(), feature: c.feature, ...call, ...(c.mode === 'replay' && { replay: true }) });
}

const MAX_CALLS = 400;

export async function flushCalls(c: Ctx) {
  if (!c.calls.length) return;
  const key = `calls-${c.sid}`;
  const existing = (await getDoc<PayPalCall[]>(key)) ?? [];
  await setDoc(key, [...existing, ...c.calls].slice(-MAX_CALLS));
  c.calls = [];
}

export async function runWith<T>(init: Pick<Ctx, 'sid' | 'mode' | 'feature'>, fn: () => Promise<T>): Promise<T> {
  const c: Ctx = { ...init, calls: [] };
  try {
    return await als.run(c, fn);
  } finally {
    await flushCalls(c).catch(() => {});
  }
}

const cookie = (req: Request, name: string) =>
  req.headers.get('cookie')?.split(/;\s*/).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);

export const sessionOf = (req: Request) => (cookie(req, 'payday_sid') ?? 'anon').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'anon';
export const modeOf = (req: Request): Mode => (cookie(req, 'payday_mode') === 'replay' ? 'replay' : 'live');

/** Wraps an API route handler with the request context. */
export function route<A extends unknown[]>(feature: string, handler: (req: Request, ...args: A) => Promise<Response>) {
  return (req: Request, ...args: A) =>
    runWith({ sid: sessionOf(req), mode: modeOf(req), feature }, async () => {
      try {
        return await handler(req, ...args);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unexpected error';
        console.error(`[${feature}]`, e);
        return Response.json({ error: message }, { status: 500 });
      }
    });
}
