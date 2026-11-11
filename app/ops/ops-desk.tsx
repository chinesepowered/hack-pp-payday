'use client';

// The operator's payouts desk: what needs a person (review queue, watchdog cards), the balance
// check, and the payout ledger with reconciliation against PayPal Transaction Search.

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnomalyCard } from '@/components/anomaly-card';
import { Rio } from '@/components/rio';
import { AiTag, Button, Card, Chip, SourceTag } from '@/components/ui';
import { ago, api, money, timeOf, useAppState } from '@/lib/client';
import type { Job } from '@/lib/types';
import { headline } from '@/lib/view';

type Balance = { available?: number; total?: number; asOf?: string; queued: number; warning?: string | null; error?: string };
type Recon = { rows: { payoutId: string; jobId: string; amount: number; status: string; transactionId: string | null; match: string; createdAt: string }[]; ledgerCount: number; lastRefreshed: string | null };

function Kpi({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-pd-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold" data-testid={testId}>{value}</p>
      {hint && <p className="text-xs text-pd-muted">{hint}</p>}
    </Card>
  );
}

export function OpsDesk() {
  const { state, reload } = useAppState(6000);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadBalance = useCallback(() => api<Balance>('/api/balance').then(setBalance).catch(() => {}), []);
  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      await reload();
      setBusy(null);
    }
  };

  const k = useMemo(() => (state ? headline(state) : null), [state]);
  if (!state || !k) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-pd-muted" role="status">
        <Rio pose="idle" size={96} className="pd-pulse" />
        Loading the payouts desk
      </div>
    );
  }

  const name = (id: string) => state.workers.find((w) => w.id === id)?.name ?? id;
  const review = state.jobs.filter((j) => j.status === 'needs_review');
  const ready = state.jobs.filter((j) => j.status === 'verified');
  const open = state.anomalies.filter((a) => a.status === 'open');
  const closed = state.anomalies.filter((a) => a.status !== 'open');
  const held = state.workers.filter((w) => w.onHold);
  const ledger = [...state.payouts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pay = (job: Job, override = false) =>
    run(`pay-${job.id}`, async () => {
      const r = await api<{ ok: boolean; blocks: string[] }>(`/api/jobs/${job.id}/pay`, { body: { override } });
      if (!r.ok) throw new Error(`Not paid. ${r.blocks.join(' ')}`);
      void loadBalance();
    }, `Sent ${money(job.amount)} to ${name(job.workerId)} through PayPal Payouts. Status updates as PayPal settles it.`);

  return (
    <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Payouts desk</h1>
          <p className="text-sm text-pd-muted">TidyNest, home cleaning marketplace. Pay each job the moment it is verified; approve what the watchdog flags.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" small busy={busy === 'refresh'} onClick={() => run('refresh', () => api('/api/payouts/refresh', { body: { all: true } }), 'Re-read every open payout from PayPal.')} data-testid="refresh-paypal">
            Refresh from PayPal
          </Button>
          <Button variant="secondary" small busy={busy === 'watchdog'} onClick={() => run('watchdog', () => api('/api/watchdog', { method: 'POST' }), 'Watchdog ran over every payout and job.')} data-testid="run-watchdog">
            Run watchdog
          </Button>
          <Link href="/dashboard" className="inline-flex min-h-9 items-center rounded-lg bg-pd-ink px-3 text-sm font-semibold text-white hover:opacity-90">
            Open dashboard
          </Link>
        </div>
      </div>

      <div aria-live="polite" className="mt-3 min-h-6">
        {notice && <p className="rounded-lg bg-pd-highlight p-2 text-sm font-medium" data-testid="ops-notice">{notice}</p>}
      </div>

      <section aria-label="Key numbers" className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Paid today" value={money(k.paidToday)} hint={`${k.payoutsToday} payouts`} testId="kpi-paid-today" />
        <Kpi label="Median time to pay" value={`${k.medianMinutesPayday.toFixed(1)} min`} hint={`Manual batches took ${k.medianDaysManual.toFixed(1)} days`} />
        <Kpi label="Unclaimed money" value={money(k.unclaimed)} hint={`${k.unclaimedCount} payout${k.unclaimedCount === 1 ? '' : 's'} not picked up`} testId="kpi-unclaimed" />
        <Kpi label="Open anomalies" value={String(k.openAnomalies)} hint={`${money(k.atRisk)} at risk`} testId="kpi-anomalies" />
        <Card className="col-span-2 p-4 lg:col-span-1" data-testid="balance-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-pd-muted">PayPal balance</p>
          <p className="mt-1 text-2xl font-extrabold">{balance?.available !== undefined ? money(balance.available) : 'n/a'}</p>
          <p className="text-xs text-pd-muted">
            {balance?.asOf ? `As of ${timeOf(balance.asOf)}. ` : ''}Ready to pay: {money(balance?.queued ?? 0)}
          </p>
          {balance?.warning && <p role="alert" className="mt-1 text-xs font-semibold text-pd-danger">{balance.warning}</p>}
        </Card>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <section aria-labelledby="wd-h">
          <div className="flex items-center justify-between">
            <h2 id="wd-h" className="text-lg font-bold">Watchdog</h2>
            <p className="text-xs text-pd-muted">Rules find it, AI explains it, you approve the action.</p>
          </div>
          {open.length === 0 ? (
            <Card className="mt-2 flex items-center gap-3 p-5">
              <Rio pose="paid" size={72} />
              <div>
                <p className="font-bold">Nothing to act on.</p>
                <p className="text-sm text-pd-muted">Every payout matches a verified job, one to one.</p>
              </div>
            </Card>
          ) : (
            <div className="mt-2 space-y-3">
              {open.map((a) => (
                <AnomalyCard key={a.id} anomaly={a} worker={name(a.workerId)} onChanged={() => reload()} />
              ))}
            </div>
          )}
          {closed.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-pd-teal-dark">Handled ({closed.length})</summary>
              <div className="mt-2 space-y-3">
                {closed.map((a) => (
                  <AnomalyCard key={a.id} anomaly={a} worker={name(a.workerId)} onChanged={() => reload()} />
                ))}
              </div>
            </details>
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="rq-h">
            <h2 id="rq-h" className="text-lg font-bold">Needs review ({review.length})</h2>
            {review.length === 0 ? (
              <Card className="mt-2 p-4 text-sm text-pd-muted">No jobs are waiting for a person. Jobs the AI cannot verify land here.</Card>
            ) : (
              <ul className="mt-2 space-y-3">
                {review.map((job) => (
                  <li key={job.id}>
                    <Card className="p-4" data-testid="review-job">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold">{job.type}, {name(job.workerId)}</p>
                          <p className="text-sm text-pd-muted">{job.id}, {job.customer}, {job.address}</p>
                        </div>
                        <p className="text-lg font-extrabold">{money(job.amount)}</p>
                      </div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {job.verification?.checks.filter((c) => !c.pass).map((c) => (
                          <li key={c.id} className="flex gap-2 rounded-lg bg-pd-amber-bg p-2">
                            <span aria-hidden="true" className="font-bold text-pd-amber">!</span>
                            <span>
                              <strong>{c.label}:</strong> {c.detail} {c.by === 'ai' && job.verification && <AiTag model={job.verification.model} className="ml-1 align-middle" />}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <ul className="mt-2 flex gap-2 overflow-x-auto">
                        {job.photos.map((src) => (
                          <li key={src} className="w-24 flex-none overflow-hidden rounded-lg border border-pd-border">
                            <Image src={src} alt={`Completion photo: ${src.split('/').pop()?.replace(/-\d\.png$/, '')}`} width={192} height={144} className="h-auto w-full" />
                          </li>
                        ))}
                      </ul>
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer font-semibold text-pd-teal-dark">Reasoning trail</summary>
                        <ol className="mt-1 space-y-1 border-l-2 border-pd-border pl-3 text-pd-muted">
                          {job.verification?.trail.map((t, i) => (
                            <li key={i}>
                              <strong className="text-pd-ink">{t.step}:</strong> {t.detail} {t.model && <AiTag model={t.model} className="ml-1 align-middle" />}
                            </li>
                          ))}
                        </ol>
                      </details>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button small busy={busy === `pay-${job.id}`} onClick={() => void pay(job, true)} data-testid="approve-and-pay">
                          Approve and pay {money(job.amount)}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {ready.length > 0 && (
            <section aria-labelledby="rp-h">
              <h2 id="rp-h" className="text-lg font-bold">Verified, not paid ({ready.length})</h2>
              <Card className="mt-2 divide-y divide-pd-border">
                {ready.map((job) => (
                  <div key={job.id} className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="ready-job">
                    <span className="flex-1">
                      <strong>{job.id}</strong> {job.type}, {name(job.workerId)}
                    </span>
                    <strong>{money(job.amount)}</strong>
                    <Button small variant="secondary" busy={busy === `pay-${job.id}`} onClick={() => void pay(job)}>
                      Pay now
                    </Button>
                  </div>
                ))}
                {ready.length > 1 && (
                  <div className="p-3">
                    <Button
                      small
                      busy={busy === 'batch'}
                      onClick={() =>
                        run('batch', async () => {
                          const r = await api<{ results: { ok: boolean; blocks: string[]; job: Job }[] }>('/api/payouts/batch', { body: { jobIds: ready.map((j) => j.id) } });
                          const blocked = r.results.filter((x) => !x.ok);
                          void loadBalance();
                          if (blocked.length) throw new Error(`${r.results.length - blocked.length} paid. Held: ${blocked.map((b) => `${b.job.id} (${b.blocks[0]})`).join('; ')}`);
                        }, 'Batch sent through PayPal Payouts.')
                      }
                    >
                      Pay all in one batch ({money(ready.reduce((s, j) => s + j.amount, 0))})
                    </Button>
                  </div>
                )}
              </Card>
            </section>
          )}

          {held.length > 0 && (
            <section aria-labelledby="hold-h">
              <h2 id="hold-h" className="text-lg font-bold">Payout holds</h2>
              <Card className="mt-2 divide-y divide-pd-border">
                {held.map((w) => (
                  <div key={w.id} className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="hold-row">
                    <span className="flex-1">
                      <strong>{w.name}</strong>: {w.holdReason}
                    </span>
                    <Button small variant="secondary" busy={busy === `rel-${w.id}`} onClick={() => run(`rel-${w.id}`, () => api(`/api/workers/${w.id}/release`, { method: 'POST' }), `Hold released for ${w.name}.`)}>
                      Release hold
                    </Button>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </div>
      </div>

      <section aria-labelledby="led-h" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="led-h" className="text-lg font-bold">Payout ledger</h2>
          <Button
            small
            variant="secondary"
            busy={busy === 'recon'}
            onClick={() => run('recon', async () => setRecon(await api<Recon>('/api/reconcile')))}
            data-testid="reconcile"
          >
            Reconcile with PayPal Transaction Search
          </Button>
        </div>
        {recon && (
          <Card className="mt-2 p-3 text-sm" data-testid="recon-panel">
            <p>
              PayPal Transaction Search returned <strong>{recon.ledgerCount}</strong> transactions for the last 3 days
              {recon.lastRefreshed ? ` (PayPal last refreshed it ${timeOf(recon.lastRefreshed)})` : ''}. It lags the ledger by up to 3 hours, so a recent payout
              shows as waiting, not as missing.
            </p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {recon.rows.map((r) => (
                <li key={r.payoutId} className="flex items-center justify-between gap-2 rounded bg-pd-sand px-2 py-1">
                  <span className="truncate">{r.jobId} {money(r.amount)} <span className="text-pd-muted">{r.transactionId ?? ''}</span></span>
                  <Chip value={r.match === 'matched' ? 'SUCCESS' : r.match === 'missing' || r.match === 'amount differs' ? 'FAILED' : 'PENDING'} label={r.match} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-2 overflow-x-auto rounded-xl border border-pd-border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Payouts, newest first</caption>
            <thead className="border-b border-pd-border text-xs uppercase tracking-wide text-pd-muted">
              <tr>
                <th scope="col" className="p-3">When</th>
                <th scope="col" className="p-3">Worker</th>
                <th scope="col" className="p-3">Job</th>
                <th scope="col" className="p-3 text-right">Amount</th>
                <th scope="col" className="p-3">Status</th>
                <th scope="col" className="p-3">Time to pay</th>
                <th scope="col" className="p-3">Channel</th>
                <th scope="col" className="p-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pd-border">
              {ledger.slice(0, showAll ? 200 : 12).map((p) => (
                <tr key={p.id} data-testid="ledger-row">
                  <td className="p-3 whitespace-nowrap">{timeOf(p.createdAt)}</td>
                  <td className="p-3">{name(p.workerId)}</td>
                  <td className="p-3">
                    {p.jobId}
                    {p.itemId && <span className="block font-mono text-[11px] text-pd-muted">item {p.itemId}</span>}
                  </td>
                  <td className="p-3 text-right font-semibold">{money(p.amount)}</td>
                  <td className="p-3"><Chip value={p.status} /></td>
                  <td className="p-3 whitespace-nowrap">{p.secondsToPay ? ago(p.secondsToPay) : ''}</td>
                  <td className="p-3 whitespace-nowrap">{p.channel === 'payday' ? 'Payday' : 'Manual batch'}</td>
                  <td className="p-3"><SourceTag source={p.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="ghost" small className="mt-2" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show fewer' : `Show all ${ledger.length} payouts`}
        </Button>
      </section>
    </div>
  );
}
