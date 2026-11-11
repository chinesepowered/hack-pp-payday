'use client';

// Browser helpers: API calls, the shared app-state hook (with polling) and formatters.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicState } from './view';

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string | { message?: string } };
  if (!res.ok) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : err?.message ?? `Request failed (${res.status})`);
  }
  window.dispatchEvent(new Event('payday:calls'));
  return json;
}

/** The app state, re-read on demand and every `pollMs` (pending payouts are re-read from PayPal). */
export function useAppState(pollMs = 0) {
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async (refresh?: 'pending' | 'all') => {
    if (busy.current) return;
    busy.current = true;
    try {
      setState(await api<PublicState>(`/api/state${refresh ? `?refresh=${refresh === 'all' ? 'all' : '1'}` : ''}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void reload();
    if (!pollMs) return;
    const timer = setInterval(() => void reload('pending'), pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);

  return { state, setState, error, reload };
}

export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortModel = (model: string) => model.split('/').pop() ?? model;

export function ago(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function getCookie(name: string) {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split('; ').find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
}
