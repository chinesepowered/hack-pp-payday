'use client';

// The app chrome: brand, navigation, the Live / Replay switch and the Under the hood drawer that
// lists every PayPal call this session made.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getCookie, setCookie } from '@/lib/client';
import type { PayPalCall } from '@/lib/types';
import { Rio } from './rio';
import { Button, cx } from './ui';

const NAV = [
  { href: '/worker', label: 'Worker app' },
  { href: '/ops', label: 'Payouts desk' },
  { href: '/dashboard', label: 'Dashboard' },
];

export function Chrome() {
  const pathname = usePathname();
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<PayPalCall[]>([]);
  const [switching, setSwitching] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/calls', { cache: 'no-store' });
      const json = (await res.json()) as { calls: PayPalCall[] };
      setCalls(json.calls);
    } catch {}
  }, []);

  useEffect(() => {
    if (!getCookie('payday_sid')) setCookie('payday_sid', `s-${Math.random().toString(36).slice(2, 12)}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cookies are only readable in the browser
    setMode(getCookie('payday_mode') === 'replay' ? 'replay' : 'live');
    void loadCalls();
    const onCalls = () => void loadCalls();
    window.addEventListener('payday:calls', onCalls);
    return () => window.removeEventListener('payday:calls', onCalls);
  }, [loadCalls]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const timer = setInterval(() => void loadCalls(), 2500);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, loadCalls]);

  const switchMode = async (next: 'live' | 'replay') => {
    if (next === mode) return;
    setSwitching(true);
    setCookie('payday_mode', next);
    if (next === 'replay') await api('/api/replay/reset', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-pd-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link href="/" className="flex items-center gap-2 rounded-lg pr-2" aria-label="Payday home">
            <Rio pose="idle" size={36} title="" />
            <span className="text-lg font-extrabold tracking-tight text-pd-ink">Payday</span>
            <span className="hidden rounded bg-pd-sand px-1.5 py-0.5 text-[11px] font-semibold text-pd-muted sm:inline">for TidyNest</span>
          </Link>
          <nav aria-label="Main" className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                data-testid={`nav-${item.href.slice(1)}`}
                className={cx(
                  'flex min-h-10 flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold sm:flex-none',
                  pathname.startsWith(item.href) ? 'bg-pd-highlight text-pd-teal-dark' : 'text-pd-muted hover:bg-pd-highlight',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div role="group" aria-label="Data mode" className="flex rounded-lg border border-pd-border p-0.5 text-xs font-semibold">
              {(['live', 'replay'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={switching}
                  onClick={() => void switchMode(m)}
                  data-testid={`mode-${m}`}
                  className={cx('min-h-8 rounded-md px-2.5', mode === m ? (m === 'live' ? 'bg-pd-teal text-white' : 'bg-pd-amber text-white') : 'text-pd-muted hover:bg-pd-highlight')}
                >
                  {m === 'live' ? 'Live' : 'Replay'}
                </button>
              ))}
            </div>
            <Button variant="secondary" small onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="open-hood">
              Under the hood
              <span className="rounded-full bg-pd-ink px-1.5 text-[11px] text-white" aria-label={`${calls.length} PayPal calls`}>
                {calls.length}
              </span>
            </Button>
          </div>
        </div>
        {mode === 'replay' && (
          <p role="status" className="bg-pd-amber px-4 py-1 text-center text-xs font-semibold text-white" data-testid="replay-banner">
            Replay mode: answers come from recorded sandbox and model responses. No live PayPal calls are made. Switch to Live for the real sandbox.
          </p>
        )}
      </header>

      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="hood-title">
          <button type="button" className="absolute inset-0 bg-pd-ink/40" aria-label="Close Under the hood" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl" data-testid="hood-drawer">
            <div className="flex items-start justify-between gap-3 border-b border-pd-border p-4">
              <div>
                <h2 id="hood-title" className="text-lg font-bold">Under the hood</h2>
                <p className="text-sm text-pd-muted">Every PayPal call this session made, newest first. Sandbox only: api-m.sandbox.paypal.com.</p>
              </div>
              <Button ref={closeRef} variant="ghost" small onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3" aria-live="polite">
              {calls.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-pd-muted">
                  <Rio pose="thinking" size={96} />
                  No PayPal calls yet in this session. Submit a job in the worker app, or refresh the payouts desk.
                </div>
              ) : (
                <ol className="space-y-2">
                  {calls.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="rounded-lg border border-pd-border p-2.5 text-sm" data-testid="hood-call">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx('rounded px-1.5 py-0.5 font-mono text-xs font-bold', c.method === 'GET' ? 'bg-pd-highlight text-pd-teal-dark' : 'bg-pd-ink text-white')}>{c.method}</span>
                        <code className="break-all font-mono text-[13px]">{c.path}</code>
                        <span className={cx('ml-auto rounded px-1.5 py-0.5 text-xs font-bold', c.status < 300 ? 'bg-pd-success-bg text-pd-success' : 'bg-pd-danger-bg text-pd-danger')}>{c.status}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-pd-muted">
                        <span>Feature: <strong className="text-pd-ink">{c.feature}</strong></span>
                        <span>{c.via ?? 'REST'}</span>
                        <span>PayPal-Debug-Id: <code className="font-mono text-pd-ink">{c.debugId || 'none'}</code></span>
                        <span>{c.ms} ms</span>
                        <span>{new Date(c.at).toLocaleTimeString()}</span>
                        {c.replay && <span className="font-semibold text-pd-amber">recorded (Replay)</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
