// What the browser sees, and the flat tables the dashboard is built on. Pure functions, shared by
// the operator desk, the worker app and AG Studio.

import { isDead, median, round2 } from './rules';
import type { AppState, Payout } from './types';

export type PublicState = Omit<AppState, 'webhookEvents'> & { mode: 'live' | 'replay' };

export function publicState(state: AppState, mode: 'live' | 'replay'): PublicState {
  const { webhookEvents: _omit, ...rest } = state;
  void _omit;
  return { ...rest, mode };
}

/** Pacific calendar day of a timestamp (the demo runs in November, UTC-8). */
export const ptDay = (iso: string) => new Date(Date.parse(iso) - 8 * 3_600_000).toISOString().slice(0, 10);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekday = (day: string) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
export const sourceLabel = (s: 'imported' | 'live') => (s === 'imported' ? 'Imported history' : 'Live sandbox');

export type PayoutRow = {
  id: string; jobId: string; workerId: string; worker: string; email: string; amount: number; fee: number; status: string;
  channel: string; source: string; date: string; weekday: string; createdAt: string; minutesToPay: number | null;
  duplicate: boolean; duplicateAmount: number; unclaimedAmount: number; paypalItemId: string; paypalBatchId: string; flags: string;
};

export function buildTables(state: Pick<AppState, 'workers' | 'jobs' | 'payouts' | 'orders' | 'anomalies'>) {
  const workerName = (id: string) => state.workers.find((w) => w.id === id)?.name ?? id;
  const firstByJob = new Map<string, string>();
  for (const p of [...state.payouts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (!isDead(p) && !firstByJob.has(p.jobId)) firstByJob.set(p.jobId, p.id);
  const flagsFor = (p: Payout) => state.anomalies.filter((a) => a.payoutIds.includes(p.id)).map((a) => a.kind.replace(/_/g, ' ')).join(', ');

  const payouts: PayoutRow[] = state.payouts.map((p) => {
    const date = ptDay(p.createdAt);
    const duplicate = !isDead(p) && firstByJob.get(p.jobId) !== p.id;
    return {
      id: p.id, jobId: p.jobId, workerId: p.workerId, worker: workerName(p.workerId), email: p.email, amount: p.amount, fee: p.fee,
      status: p.status, channel: p.channel === 'payday' ? 'Payday (same day)' : 'Manual batch', source: sourceLabel(p.source), date,
      weekday: weekday(date), createdAt: p.createdAt, minutesToPay: p.secondsToPay !== undefined ? round2(p.secondsToPay / 60) : null,
      duplicate, duplicateAmount: duplicate ? p.amount : 0, unclaimedAmount: p.status === 'UNCLAIMED' ? p.amount : 0,
      paypalItemId: p.itemId ?? '', paypalBatchId: p.batchId ?? '', flags: flagsFor(p),
    };
  });

  const jobs = state.jobs.map((j) => ({
    id: j.id, workerId: j.workerId, worker: workerName(j.workerId), customer: j.customer, address: j.address, type: j.type, hours: j.hours,
    amount: j.amount, customerPrice: j.customerPrice, status: j.status.replace('_', ' '), source: sourceLabel(j.source),
    date: ptDay(j.completedAt ?? j.scheduledStart), verdict: j.verification?.verdict.replace('_', ' ') ?? '',
  }));

  const workers = state.workers.map((w) => {
    const mine = state.payouts.filter((p) => p.workerId === w.id && !isDead(p));
    const paid = mine.filter((p) => p.status === 'SUCCESS');
    return {
      id: w.id, name: w.name, area: w.area, hourlyRate: w.hourlyRate, email: w.email, onHold: Boolean(w.onHold),
      jobs: state.jobs.filter((j) => j.workerId === w.id && j.status === 'paid').length,
      hours: round2(state.jobs.filter((j) => j.workerId === w.id && j.completedAt).reduce((s, j) => s + j.hours, 0)),
      earned: round2(paid.reduce((s, p) => s + p.amount, 0)),
      medianMinutesToPay: round2(median(paid.filter((p) => p.channel === 'payday' && p.secondsToPay).map((p) => p.secondsToPay! / 60))),
      openFlags: state.anomalies.filter((a) => a.workerId === w.id && a.status === 'open').length,
    };
  });

  const anomalies = state.anomalies.map((a) => ({
    id: a.id, kind: a.kind.replace(/_/g, ' '), severity: a.severity, title: a.title, worker: workerName(a.workerId), amountAtRisk: a.amountAtRisk,
    status: a.status, suggestedAction: a.suggestedAction.replace(/_/g, ' '), date: ptDay(a.detectedAt),
  }));

  // Money in (customers, Orders) against money out (workers, Payouts) and fees, per day.
  const days = new Map<string, { date: string; weekday: string; moneyIn: number; moneyOut: number; payoutFees: number; orderFees: number; payouts: number }>();
  const day = (d: string) => {
    if (!days.has(d)) days.set(d, { date: d, weekday: weekday(d), moneyIn: 0, moneyOut: 0, payoutFees: 0, orderFees: 0, payouts: 0 });
    return days.get(d)!;
  };
  for (const o of state.orders) {
    const d = day(ptDay(o.capturedAt));
    d.moneyIn = round2(d.moneyIn + o.amount);
    d.orderFees = round2(d.orderFees + o.fee);
  }
  for (const p of state.payouts) {
    if (isDead(p)) continue;
    const d = day(ptDay(p.createdAt));
    d.moneyOut = round2(d.moneyOut + p.amount);
    d.payoutFees = round2(d.payoutFees + p.fee);
    d.payouts += 1;
  }
  const cashflow = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, net: round2(d.moneyIn - d.moneyOut - d.payoutFees - d.orderFees) }));

  const orders = state.orders.map((o) => ({ id: o.id, jobId: o.jobId, amount: o.amount, fee: o.fee, status: o.status, source: sourceLabel(o.source), date: ptDay(o.capturedAt) }));

  return { payouts, jobs, workers, anomalies, cashflow, orders };
}

export function headline(state: Pick<AppState, 'payouts' | 'anomalies'>, now = new Date()) {
  const today = ptDay(now.toISOString());
  const alive = state.payouts.filter((p) => !isDead(p));
  const todays = alive.filter((p) => ptDay(p.createdAt) === today);
  const payday = alive.filter((p) => p.channel === 'payday' && p.secondsToPay);
  const manual = alive.filter((p) => p.channel === 'manual batch' && p.secondsToPay);
  return {
    paidToday: round2(todays.filter((p) => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0)),
    payoutsToday: todays.length,
    medianMinutesPayday: round2(median(payday.map((p) => p.secondsToPay! / 60))),
    medianDaysManual: round2(median(manual.map((p) => p.secondsToPay! / 86_400))),
    unclaimed: round2(alive.filter((p) => p.status === 'UNCLAIMED').reduce((s, p) => s + p.amount, 0)),
    unclaimedCount: alive.filter((p) => p.status === 'UNCLAIMED').length,
    openAnomalies: state.anomalies.filter((a) => a.status === 'open').length,
    atRisk: round2(state.anomalies.filter((a) => a.status === 'open').reduce((s, a) => s + a.amountAtRisk, 0)),
    feesToday: round2(todays.reduce((s, p) => s + p.fee, 0)),
  };
}
