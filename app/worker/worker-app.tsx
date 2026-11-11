'use client';

// The worker app (mobile first). A worker submits the completion checklist and photos; the AI
// checks the evidence; a verified job is paid at once through PayPal Payouts, and the worker
// sees the money land.

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Rio } from '@/components/rio';
import { AiTag, Button, Card, Chip, cx } from '@/components/ui';
import { ago, api, money, timeOf, useAppState } from '@/lib/client';
import type { Job, Payout } from '@/lib/types';

const LIVE_WORKERS = ['w1', 'w2', 'w3'];

type Step = { key: string; label: string; state: 'doing' | 'done' | 'warn'; detail?: string };
type Flow = { jobId: string; steps: Step[]; outcome?: 'paid' | 'review' | 'held' | 'error'; payoutId?: string; message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WorkerApp() {
  const { state, reload } = useAppState();
  const [workerId, setWorkerId] = useState('w1');
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [flow, setFlow] = useState<Flow | null>(null);
  const [sound, setSound] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get('w');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is only readable in the browser
    if (w && LIVE_WORKERS.includes(w)) setWorkerId(w);
  }, []);

  const worker = state?.workers.find((w) => w.id === workerId);
  const jobs = useMemo(() => (state?.jobs ?? []).filter((j) => j.workerId === workerId && j.source === 'live'), [state, workerId]);
  const todo = jobs.filter((j) => j.status === 'scheduled');
  const payouts = useMemo(
    () => (state?.payouts ?? []).filter((p) => p.workerId === workerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state, workerId],
  );
  const messages = (state?.messages ?? []).filter((m) => m.workerId === workerId);
  const [weekStart] = useState(() => Date.now() - 7 * 86_400_000);
  const weekTotal = payouts.filter((p) => p.status === 'SUCCESS' && Date.parse(p.createdAt) > weekStart).reduce((s, p) => s + p.amount, 0);

  const say = (file: string) => {
    if (!sound) return;
    audio.current?.pause();
    audio.current = new Audio(`/audio/${file}.mp3`);
    audio.current.play().catch(() => {});
  };

  async function submit(job: Job) {
    const steps: Step[] = [{ key: 'ai', label: 'Checking your photos and check-in with AI', state: 'doing' }];
    const update = (patch: Partial<Flow>) => setFlow((f) => ({ jobId: job.id, steps: [...steps], ...(f?.jobId === job.id ? { outcome: f.outcome, payoutId: f.payoutId, message: f.message } : {}), ...patch }));
    update({});
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    try {
      const { job: verified } = await api<{ job: Job }>(`/api/jobs/${job.id}/submit`, { method: 'POST' });
      await reload();
      if (verified.status !== 'verified') {
        steps[0] = { ...steps[0], state: 'warn', label: 'A person at TidyNest will take a look', detail: verified.verification?.reasons.join(' ') };
        update({ outcome: 'review' });
        say('rio-review');
        return;
      }
      steps[0] = { ...steps[0], state: 'done', label: 'Verified by AI', detail: verified.verification?.reasons[0] };
      steps.push({ key: 'pay', label: 'Sending your pay through PayPal Payouts', state: 'doing' });
      update({});
      const paid = await api<{ ok: boolean; blocks: string[]; payout?: Payout }>(`/api/jobs/${job.id}/pay`, { method: 'POST', body: {} });
      if (!paid.ok || !paid.payout) {
        steps[1] = { ...steps[1], state: 'warn', label: 'Your pay is waiting for the TidyNest team', detail: paid.blocks.join(' ') };
        update({ outcome: 'held' });
        await reload();
        return;
      }
      steps[1] = { ...steps[1], state: 'done', label: 'PayPal accepted the payout', detail: `Batch ${paid.payout.batchId}` };
      steps.push({ key: 'land', label: 'Waiting for the money to land', state: 'doing' });
      update({ payoutId: paid.payout.id });
      for (let i = 0; i < 40; i++) {
        const fresh = await api<{ payouts: Payout[] }>('/api/payouts/refresh', { body: { payoutId: paid.payout.id } });
        const p = fresh.payouts.find((x) => x.id === paid.payout!.id);
        if (p && p.status !== 'PENDING') {
          if (p.status === 'SUCCESS') {
            steps[2] = { ...steps[2], state: 'done', label: 'Paid', detail: `PayPal item ${p.itemId}` };
            update({ outcome: 'paid' });
            say('rio-paid');
          } else {
            steps[2] = { ...steps[2], state: 'warn', label: `PayPal reports ${p.status}`, detail: 'The TidyNest team has been told.' };
            update({ outcome: 'held' });
          }
          await reload();
          return;
        }
        await sleep(2500);
      }
      steps[2] = { ...steps[2], state: 'warn', label: 'Still pending at PayPal', detail: 'The sandbox can take a while. Your earnings list updates by itself.' };
      update({ outcome: 'held' });
    } catch (e) {
      const last = steps.length - 1;
      steps[last] = { ...steps[last], state: 'warn', detail: e instanceof Error ? e.message : 'Something went wrong.' };
      update({ outcome: 'error' });
    }
  }

  if (!state || !worker) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-pd-muted" role="status">
        <Rio pose="idle" size={96} className="pd-pulse" />
        Loading your jobs
      </div>
    );
  }

  const flowJob = flow ? state.jobs.find((j) => j.id === flow.jobId) : undefined;
  const flowPayout = flow?.payoutId ? state.payouts.find((p) => p.id === flow.payoutId) : undefined;

  return (
    <div className="mx-auto w-full max-w-[480px] flex-1 px-4 pb-16 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">Hi {worker.name.split(' ')[0]}</h1>
          <p className="text-sm text-pd-muted">TidyNest cleaner, {worker.area}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <label htmlFor="worker-pick" className="text-[11px] font-semibold uppercase tracking-wide text-pd-muted">Demo: view as</label>
          <select
            id="worker-pick"
            value={workerId}
            onChange={(e) => {
              setWorkerId(e.target.value);
              setFlow(null);
              setOpenJob(null);
            }}
            className="min-h-10 rounded-lg border border-pd-border bg-white px-2 text-sm font-semibold"
            data-testid="worker-select"
          >
            {state.workers.filter((w) => LIVE_WORKERS.includes(w.id)).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl bg-pd-ink p-4 text-white">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-pd-mint">Paid in the last 7 days</p>
          <p className="text-3xl font-extrabold" data-testid="week-total">{money(weekTotal)}</p>
          <p className="text-xs text-pd-mint">to {worker.email}</p>
        </div>
        <button
          type="button"
          onClick={() => setSound((s) => !s)}
          aria-pressed={sound}
          className="min-h-10 rounded-lg border border-white/30 px-3 text-xs font-semibold"
        >
          Rio&apos;s voice: {sound ? 'on' : 'off'}
        </button>
      </div>

      {worker.onHold && (
        <p role="status" className="mt-3 rounded-lg bg-pd-amber-bg p-3 text-sm font-medium text-pd-amber">
          Your payouts are on hold while TidyNest checks something: {worker.holdReason}.
        </p>
      )}

      {messages.length > 0 && (
        <section aria-labelledby="msg-h" className="mt-5">
          <h2 id="msg-h" className="text-sm font-bold uppercase tracking-wide text-pd-muted">Messages from TidyNest</h2>
          <ul className="mt-2 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-pd-border bg-white p-3 text-sm" data-testid="worker-message">
                {m.text}
                <span className="mt-1 block text-xs text-pd-muted">{timeOf(m.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div ref={resultRef} aria-live="polite" className="scroll-mt-28">
        {flow && flowJob && (
          <Card className="mt-5 overflow-hidden" data-testid="flow-card">
            {flow.outcome === 'paid' && flowPayout ? (
              <div className="pd-pop flex flex-col items-center gap-1 bg-pd-success-bg p-5 text-center" data-testid="paid-card">
                <Rio pose="paid" size={132} />
                <p className="text-sm font-bold uppercase tracking-wide text-pd-success">You got paid!</p>
                <p className="text-3xl font-extrabold text-pd-ink" data-testid="paid-line">
                  Paid {money(flowPayout.amount)}
                </p>
                <p className="text-base font-semibold text-pd-ink">
                  {ago(flowPayout.secondsToPay ?? 1)} after you finished
                </p>
                <p className="text-xs text-pd-muted">PayPal Payouts item {flowPayout.itemId}, to {flowPayout.email}</p>
              </div>
            ) : flow.outcome === 'review' ? (
              <div className="flex items-center gap-3 bg-pd-amber-bg p-4" data-testid="review-card">
                <Rio pose="thinking" size={84} />
                <div>
                  <p className="font-bold text-pd-ink">Not paid yet: one thing is missing</p>
                  <p className="text-sm text-pd-ink">A person at TidyNest will review this job today. You do not need to do anything.</p>
                </div>
              </div>
            ) : null}
            <div className="p-4">
              <p className="text-sm font-bold">{flowJob.type} for {flowJob.customer}</p>
              <ol className="mt-2 space-y-2">
                {flow.steps.map((s) => (
                  <li key={s.key} className="flex gap-2 text-sm" data-testid={`step-${s.key}`} data-state={s.state}>
                    <span
                      aria-hidden="true"
                      className={cx(
                        'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white',
                        s.state === 'done' ? 'bg-pd-success' : s.state === 'warn' ? 'bg-pd-amber' : 'pd-pulse bg-pd-teal',
                      )}
                    >
                      {s.state === 'done' ? '✓' : s.state === 'warn' ? '!' : ''}
                    </span>
                    <span>
                      <span className="font-semibold">{s.label}</span>
                      {s.state === 'doing' && <span className="sr-only"> (in progress)</span>}
                      {s.detail && <span className="block text-pd-muted">{s.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {flowJob.verification && (
                <details className="mt-3 rounded-lg bg-pd-sand p-3 text-sm" open={flow.outcome === 'review'}>
                  <summary className="cursor-pointer font-semibold">
                    What the AI checked <AiTag model={flowJob.verification.model} className="ml-1" />
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {flowJob.verification.checks.map((c) => (
                      <li key={c.id} className="flex gap-2">
                        <span aria-hidden="true" className={c.pass ? 'text-pd-success' : 'text-pd-danger'}>{c.pass ? '✓' : '✗'}</span>
                        <span>
                          <span className="font-medium">{c.label}</span> <span className="sr-only">{c.pass ? 'passed' : 'failed'}</span>
                          <span className="block text-pd-muted">{c.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </Card>
        )}
      </div>

      <section aria-labelledby="todo-h" className="mt-6">
        <h2 id="todo-h" className="text-sm font-bold uppercase tracking-wide text-pd-muted">Today&apos;s jobs</h2>
        {todo.length === 0 ? (
          <Card className="mt-2 flex flex-col items-center gap-2 p-6 text-center">
            <Rio pose="wave" size={96} />
            <p className="font-semibold">All done for today.</p>
            <p className="text-sm text-pd-muted">Nothing left to submit. Want to run the demo again?</p>
            <Button
              variant="secondary"
              small
              data-testid="more-jobs"
              onClick={async () => {
                await api('/api/demo/jobs', { method: 'POST' });
                await reload();
              }}
            >
              Schedule more demo jobs
            </Button>
          </Card>
        ) : (
          <ul className="mt-2 space-y-3">
            {todo.map((job) => {
              const open = openJob === job.id;
              const allTicked = job.checklist.every((r) => ticked[`${job.id}:${r}`]);
              const running = flow?.jobId === job.id && !flow.outcome;
              return (
                <li key={job.id}>
                  <Card className="overflow-hidden" data-testid={`job-${job.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 p-4 text-left"
                      aria-expanded={open}
                      onClick={() => setOpenJob(open ? null : job.id)}
                      data-testid={`open-${job.id}`}
                    >
                      <span className="flex-1">
                        <span className="block font-bold">{job.type}</span>
                        <span className="block text-sm text-pd-muted">{job.customer}, {job.address}</span>
                        <span className="block text-sm text-pd-muted">{job.hours} h booked</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-lg font-extrabold">{money(job.amount)}</span>
                        <span className="text-xs font-semibold text-pd-teal-dark">{open ? 'Close' : 'Finish job'}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-pd-border p-4">
                        <fieldset>
                          <legend className="text-sm font-bold">Completion checklist</legend>
                          <div className="mt-2 space-y-1">
                            {job.checklist.map((room) => (
                              <label key={room} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-pd-highlight">
                                <input
                                  type="checkbox"
                                  className="h-5 w-5 accent-pd-teal"
                                  checked={Boolean(ticked[`${job.id}:${room}`])}
                                  onChange={(e) => setTicked((t) => ({ ...t, [`${job.id}:${room}`]: e.target.checked }))}
                                />
                                <span className="capitalize">{room} cleaned</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <p className="mt-3 text-sm font-bold">Photos from this visit ({job.photos.length})</p>
                        <ul className="mt-2 grid grid-cols-3 gap-2">
                          {job.photos.map((src) => (
                            <li key={src} className="overflow-hidden rounded-lg border border-pd-border">
                              <Image src={src} alt={`Completion photo: ${src.split('/').pop()?.replace(/-\d\.png$/, '')}`} width={256} height={192} className="h-auto w-full" />
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-xs text-pd-muted">Demo photo sets are seeded per job. One job on this account is missing a required room on purpose.</p>
                        <div className="mt-4 flex gap-2">
                          <Button
                            variant="secondary"
                            small
                            onClick={() => setTicked((t) => ({ ...t, ...Object.fromEntries(job.checklist.map((r) => [`${job.id}:${r}`, true])) }))}
                            data-testid={`tick-all-${job.id}`}
                          >
                            Tick all
                          </Button>
                          <Button className="flex-1" disabled={!allTicked} busy={running} onClick={() => void submit(job)} data-testid={`submit-${job.id}`}>
                            Submit and get paid
                          </Button>
                        </div>
                        {!allTicked && <p className="mt-2 text-xs text-pd-muted">Tick every room to submit.</p>}
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="earn-h" className="mt-6">
        <h2 id="earn-h" className="text-sm font-bold uppercase tracking-wide text-pd-muted">Your earnings</h2>
        <ul className="mt-2 divide-y divide-pd-border overflow-hidden rounded-xl border border-pd-border bg-white">
          {payouts.slice(0, 8).map((p) => {
            const job = state.jobs.find((j) => j.id === p.jobId);
            return (
              <li key={p.id} className="flex items-center gap-3 p-3 text-sm" data-testid="earning-row">
                <span className="flex-1">
                  <span className="block font-semibold">{job?.type ?? p.jobId}</span>
                  <span className="block text-xs text-pd-muted">
                    {timeOf(p.createdAt)}
                    {p.secondsToPay && p.status === 'SUCCESS' ? `, paid ${ago(p.secondsToPay)} after the job` : ''}
                  </span>
                </span>
                <Chip value={p.status} />
                <span className="w-20 text-right font-bold">{money(p.amount)}</span>
              </li>
            );
          })}
          {payouts.length === 0 && <li className="p-4 text-sm text-pd-muted">No payouts yet.</li>}
        </ul>
        <p className="mt-2 text-xs text-pd-muted">Sandbox money only. Payouts go to a PayPal sandbox account.</p>
      </section>
    </div>
  );
}
