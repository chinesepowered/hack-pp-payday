'use client';

// Payday's custom AG Studio widgets:
//  - anomaly-feed: the watchdog's cards, with the operator's approve buttons, inside the dashboard
//  - unclaimed-actions: the same cards narrowed to unclaimed payouts (the auditor pins this one)
//  - time-to-pay: a distribution of job-done-to-paid, Payday against the old manual batches
//  - worker-earnings: one card per worker with earnings, hours, speed and holds
// They read the live app state from the Studio `context` (see ../dashboard.tsx), so an action taken
// in a widget shows up in every other widget and in Studio's own charts.

import { useState, useSyncExternalStore } from 'react';
import type { AgWidgetsConfig } from 'ag-studio';
import { createWidgets } from 'ag-studio-react';
import { AnomalyCard } from '@/components/anomaly-card';
import { Rio } from '@/components/rio';
import { isDead, median } from '@/lib/rules';
import { buildTables, ptDay, type PublicState } from '@/lib/view';

export type DashStore = {
  get: () => PublicState;
  subscribe: (listener: () => void) => () => void;
  reload: () => Promise<void>;
};
type WidgetProps = { context: { store: DashStore } };

const useDash = (props: WidgetProps) => useSyncExternalStore(props.context.store.subscribe, props.context.store.get, props.context.store.get);
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Feed({ props, only }: { props: WidgetProps; only?: string }) {
  const state = useDash(props);
  const list = state.anomalies.filter((a) => !only || a.kind === only);
  const open = list.filter((a) => a.status === 'open');
  const done = list.filter((a) => a.status !== 'open').slice(0, 3);
  const name = (id: string) => state.workers.find((w) => w.id === id)?.name;
  if (!open.length && !done.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-pd-muted">
        <Rio pose="paid" size={72} />
        {only ? 'No unclaimed payouts right now.' : 'Nothing to act on. Every payout matches a verified job.'}
      </div>
    );
  }
  return (
    <div className="h-full space-y-2 overflow-y-auto p-1 pr-2" data-testid={only ? 'widget-unclaimed-actions' : 'widget-anomaly-feed'} aria-live="polite">
      {[...open, ...done].map((a) => (
        <AnomalyCard key={a.id} anomaly={a} worker={name(a.workerId)} compact onChanged={() => props.context.store.reload()} />
      ))}
    </div>
  );
}

const AnomalyFeedWidget = (props: WidgetProps) => <Feed props={props} />;
const UnclaimedActionsWidget = (props: WidgetProps) => <Feed props={props} only="unclaimed_aging" />;

const PAYDAY_BUCKETS: [string, number, number][] = [
  ['under 1 min', 0, 60],
  ['1 to 3 min', 60, 180],
  ['3 to 6 min', 180, 360],
  ['6 to 10 min', 360, 600],
  ['over 10 min', 600, Infinity],
];
const MANUAL_BUCKETS: [string, number, number][] = [
  ['same day', 0, 86_400],
  ['1 to 2 days', 86_400, 172_800],
  ['2 to 4 days', 172_800, 345_600],
  ['over 4 days', 345_600, Infinity],
];

function Bars({ label, color, buckets, values }: { label: string; color: string; buckets: [string, number, number][]; values: number[] }) {
  const counts = buckets.map(([, lo, hi]) => values.filter((v) => v >= lo && v < hi).length);
  const max = Math.max(1, ...counts);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-pd-muted">{label}</p>
      <ul className="mt-1 space-y-1">
        {buckets.map(([name], i) => (
          <li key={name} className="grid grid-cols-[84px_1fr_28px] items-center gap-2 text-xs">
            <span className="text-pd-muted">{name}</span>
            <span className="h-4 overflow-hidden rounded bg-pd-sand" role="img" aria-label={`${name}: ${counts[i]} payouts`}>
              <span className="block h-full rounded" style={{ width: `${(counts[i] / max) * 100}%`, background: color }} />
            </span>
            <span className="text-right font-semibold">{counts[i]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimeToPayWidget(props: WidgetProps) {
  const state = useDash(props);
  const paid = state.payouts.filter((p) => p.status === 'SUCCESS' && p.secondsToPay);
  const payday = paid.filter((p) => p.channel === 'payday').map((p) => p.secondsToPay!);
  const manual = paid.filter((p) => p.channel === 'manual batch').map((p) => p.secondsToPay!);
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-2" data-testid="widget-time-to-pay">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-pd-highlight p-2">
          <p className="text-[11px] font-semibold uppercase text-pd-teal-dark">Payday median</p>
          <p className="text-xl font-extrabold">{(median(payday) / 60).toFixed(1)} min</p>
        </div>
        <div className="rounded-lg bg-pd-sand p-2">
          <p className="text-[11px] font-semibold uppercase text-pd-muted">Manual batch median</p>
          <p className="text-xl font-extrabold">{(median(manual) / 86_400).toFixed(1)} days</p>
        </div>
      </div>
      <Bars label={`Payday, same day (${payday.length} payouts)`} color="var(--pd-teal)" buckets={PAYDAY_BUCKETS} values={payday} />
      <Bars label={`Manual batches (${manual.length} payouts)`} color="var(--pd-chart-4)" buckets={MANUAL_BUCKETS} values={manual} />
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Earnings per day, last 14 days">
      <polyline points={points} fill="none" stroke="var(--pd-teal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function WorkerEarningsWidget(props: WidgetProps) {
  const state = useDash(props);
  const rows = buildTables(state).workers.sort((a, b) => b.earned - a.earned);
  const [now] = useState(() => Date.now());
  const days = Array.from({ length: 14 }, (_, i) => ptDay(new Date(now - (13 - i) * 86_400_000).toISOString()));
  return (
    <div className="grid h-full auto-rows-min gap-2 overflow-y-auto p-2 sm:grid-cols-2" data-testid="widget-worker-earnings">
      {rows.map((w) => {
        const mine = state.payouts.filter((p) => p.workerId === w.id && !isDead(p));
        const perDay = days.map((d) => mine.filter((p) => ptDay(p.createdAt) === d).reduce((s, p) => s + p.amount, 0));
        return (
          <div key={w.id} className="rounded-lg border border-pd-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">{w.name}</p>
                <p className="text-xs text-pd-muted">{w.area}, ${w.hourlyRate}/h</p>
              </div>
              <p className="text-lg font-extrabold">{money(w.earned)}</p>
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-xs text-pd-muted">
                {w.jobs} jobs, {w.hours} h{w.medianMinutesToPay ? `, paid in ${w.medianMinutesToPay.toFixed(1)} min` : ''}
              </p>
              <Spark values={perDay} />
            </div>
            <div className="mt-1 flex gap-1">
              {w.onHold && <span className="rounded-full bg-pd-amber-bg px-2 py-0.5 text-[11px] font-semibold text-pd-amber">Payouts on hold</span>}
              {w.openFlags > 0 && <span className="rounded-full bg-pd-danger-bg px-2 py-0.5 text-[11px] font-semibold text-pd-danger">{w.openFlags} open flag{w.openFlags === 1 ? '' : 's'}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ICON = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const custom = (id: string, label: string, comp: unknown, icon: string, description: string, size: { width: number; height: number }) => ({
  id,
  label,
  icon: ICON(icon),
  // No data mapping: these widgets read the live app state from the Studio context.
  form: (params: { createDefaults: (p: { dataMappingItems: never[] }) => unknown }) => params.createDefaults({ dataMappingItems: [] }),
  comp,
  defaultSize: size,
  minSize: { width: 260, height: 180 },
  ai: { description },
});

export const CUSTOM_WIDGET_IDS = ['anomaly-feed', 'unclaimed-actions', 'time-to-pay', 'worker-earnings'];

export const paydayWidgets = ((defaults: { menu?: unknown[] }) =>
  createWidgets({
    additionalTypes: [
      custom('anomaly-feed', 'Anomaly feed', AnomalyFeedWidget, '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 'Watchdog anomaly cards with evidence and the approve buttons for the suggested action. Takes no data mapping.', { width: 420, height: 560 }),
      custom('unclaimed-actions', 'Unclaimed actions', UnclaimedActionsWidget, '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 'Unclaimed payouts with a cancel button for each (PayPal cancel unclaimed item). Takes no data mapping.', { width: 420, height: 420 }),
      custom('time-to-pay', 'Time to pay', TimeToPayWidget, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'Distribution of time from job done to money received, Payday against manual batches. Takes no data mapping.', { width: 380, height: 360 }),
      custom('worker-earnings', 'Worker earnings', WorkerEarningsWidget, '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 11h5"/><path d="M19.5 8.5v5"/>', 'One card per worker with earnings, hours, pay speed and holds. Takes no data mapping.', { width: 560, height: 400 }),
    ],
    menu: [...(defaults.menu ?? []), { label: 'Payday', widgetIds: CUSTOM_WIDGET_IDS }],
  } as never)) as unknown as AgWidgetsConfig;
