import { describe, expect, it } from 'vitest';
import { balanceWarning, detectAnomalies, editDistance, LIMITS, mergeAnomalies, payDecision, recordChecks } from '../lib/rules';
import { buildSeedState, manualBatchPlan, typoEmail } from '../lib/seed-data';
import type { Job, Payout, Worker } from '../lib/types';
import { buildTables, headline } from '../lib/view';

const NOW = new Date('2026-11-11T20:00:00Z');
const worker: Worker = { id: 'w1', name: 'Maya Okafor', email: 'maya@example.com', area: 'Mission', hourlyRate: 34.4 };
const job = (over: Partial<Job> = {}): Job => ({
  id: 'J-1', workerId: 'w1', customer: 'C', address: 'A', lat: 37.76, lng: -122.41, type: 'Standard clean', checklist: ['kitchen', 'bathroom'],
  scheduledStart: '2026-11-11T16:00:00Z', scheduledEnd: '2026-11-11T18:30:00Z', checkInAt: '2026-11-11T16:03:00Z', checkInLat: 37.7603, checkInLng: -122.4102,
  completedAt: '2026-11-11T18:28:00Z', hours: 2.5, amount: 86, customerPrice: 125, photos: [], status: 'verified', source: 'live', ...over,
});
const payout = (over: Partial<Payout> = {}): Payout => ({
  id: 'P-1', jobId: 'J-1', workerId: 'w1', email: 'maya@example.com', amount: 86, fee: 0.25, status: 'SUCCESS', source: 'live', channel: 'payday',
  createdAt: '2026-11-11T18:30:00Z', ...over,
});

describe('payDecision: the rules checked before PayPal is called', () => {
  it('pays a verified job at the job amount', () => {
    expect(payDecision(job(), worker, { payouts: [] }, { availableBalance: 500, now: NOW })).toEqual({ ok: true, amount: 86, blocks: [] });
  });
  it('never pays a job that is not verified', () => {
    for (const status of ['scheduled', 'submitted', 'needs_review', 'rejected', 'paid'] as const)
      expect(payDecision(job({ status }), worker, { payouts: [] }, { now: NOW }).ok).toBe(false);
  });
  it('blocks a second payout for the same job (duplicate guard)', () => {
    const d = payDecision(job(), worker, { payouts: [payout({ status: 'PENDING' })] }, { now: NOW });
    expect(d.ok).toBe(false);
    expect(d.blocks.join(' ')).toMatch(/duplicate/);
  });
  it('allows paying again after the first payout was cancelled or returned', () => {
    for (const status of ['CANCELED', 'RETURNED', 'FAILED'] as const)
      expect(payDecision(job(), worker, { payouts: [payout({ status })] }, { now: NOW }).ok).toBe(true);
  });
  it('blocks an amount above the rate tolerance', () => {
    expect(payDecision(job({ amount: 860 }), worker, { payouts: [] }, { now: NOW }).ok).toBe(false);
    expect(payDecision(job({ amount: 99 }), worker, { payouts: [] }, { now: NOW }).ok).toBe(false); // 34.4 x 2.5 x 1.15 = 98.90
    expect(payDecision(job({ amount: 98.9 }), worker, { payouts: [] }, { now: NOW }).ok).toBe(true);
  });
  it('blocks anything above the hard cap even when the rate allows it', () => {
    const rich = { ...worker, hourlyRate: 400 };
    expect(payDecision(job({ amount: LIMITS.maxSinglePayout + 1 }), rich, { payouts: [] }, { now: NOW }).ok).toBe(false);
  });
  it('blocks zero and negative amounts', () => {
    expect(payDecision(job({ amount: 0 }), worker, { payouts: [] }, { now: NOW }).ok).toBe(false);
    expect(payDecision(job({ amount: -5 }), worker, { payouts: [] }, { now: NOW }).ok).toBe(false);
  });
  it('holds payouts to a worker the operator put on hold', () => {
    const d = payDecision(job(), { ...worker, onHold: true, holdReason: 'Overpayment' }, { payouts: [] }, { now: NOW });
    expect(d.ok).toBe(false);
    expect(d.blocks[0]).toMatch(/on hold/);
  });
  it('holds a large payout right after an email change, but lets a small one through', () => {
    const changed = { ...worker, hourlyRate: 60, emailChangedAt: '2026-11-11T19:00:00Z' };
    expect(payDecision(job({ amount: 150 }), changed, { payouts: [] }, { now: NOW }).ok).toBe(false);
    expect(payDecision(job({ amount: 86 }), changed, { payouts: [] }, { now: NOW }).ok).toBe(true);
    const longAgo = { ...changed, emailChangedAt: '2026-11-09T19:00:00Z' };
    expect(payDecision(job({ amount: 150 }), longAgo, { payouts: [] }, { now: NOW }).ok).toBe(true);
  });
  it('blocks a payout the PayPal balance cannot cover', () => {
    expect(payDecision(job(), worker, { payouts: [] }, { availableBalance: 85.99, now: NOW }).ok).toBe(false);
    expect(payDecision(job(), worker, { payouts: [] }, { availableBalance: 86, now: NOW }).ok).toBe(true);
  });
  it('blocks a job with an unknown worker', () => {
    expect(payDecision(job(), undefined, { payouts: [] }, { now: NOW }).ok).toBe(false);
  });
});

describe('balanceWarning', () => {
  it('warns before a batch would exceed or nearly use the balance', () => {
    expect(balanceWarning(600, 500)).toMatch(/exceeds/);
    expect(balanceWarning(450, 500)).toMatch(/80%/);
    expect(balanceWarning(100, 500)).toBeNull();
    expect(balanceWarning(100, undefined)).toBeNull();
  });
});

describe('recordChecks: job record against the booking', () => {
  it('passes an on-time, on-site, full-length visit', () => {
    expect(recordChecks(job()).every((c) => c.pass)).toBe(true);
  });
  it('fails a late check-in, a short visit and a far-away check-in', () => {
    expect(recordChecks(job({ checkInAt: '2026-11-11T16:45:00Z' })).find((c) => c.id === 'check-in-time')?.pass).toBe(false);
    expect(recordChecks(job({ checkInAt: '2026-11-11T17:40:00Z' })).find((c) => c.id === 'duration')?.pass).toBe(false);
    expect(recordChecks(job({ checkInLat: 37.79 })).find((c) => c.id === 'location')?.pass).toBe(false);
  });
});

describe('watchdog', () => {
  const base = { workers: [worker], jobs: [job({ status: 'paid' })] };
  it('finds nothing when one payout matches one job', () => {
    expect(detectAnomalies({ ...base, payouts: [payout()] }, NOW)).toEqual([]);
  });
  it('flags a duplicate payout and counts only the extra as at risk', () => {
    const found = detectAnomalies({ ...base, payouts: [payout(), payout({ id: 'P-2', createdAt: '2026-11-11T19:00:00Z' })] }, NOW);
    expect(found.map((f) => f.kind)).toEqual(['duplicate_payout']);
    expect(found[0].amountAtRisk).toBe(86);
    expect(found[0].suggestedAction).toBe('hold_next_payout');
  });
  it('ignores cancelled payouts when looking for duplicates', () => {
    expect(detectAnomalies({ ...base, payouts: [payout(), payout({ id: 'P-2', status: 'CANCELED' })] }, NOW)).toEqual([]);
  });
  it('flags an amount far above the job amount', () => {
    const found = detectAnomalies({ ...base, payouts: [payout({ amount: 860 })] }, NOW);
    expect(found[0].kind).toBe('overpayment');
    expect(found[0].amountAtRisk).toBe(774);
  });
  it('flags a payout sent soon after the payout email changed', () => {
    const w = { ...worker, previousEmail: 'old@example.com', emailChangedAt: '2026-11-11T17:00:00Z' };
    const found = detectAnomalies({ workers: [w], jobs: base.jobs, payouts: [payout()] }, NOW);
    expect(found.map((f) => f.kind)).toEqual(['email_change']);
  });
  it('flags an unclaimed payout to a mistyped email at once, and any unclaimed payout after 72 hours', () => {
    const typo = detectAnomalies({ ...base, payouts: [payout({ status: 'UNCLAIMED', email: 'maya@exmaple.com' })] }, NOW);
    expect(typo[0].kind).toBe('unclaimed_aging');
    expect(typo[0].suggestedAction).toBe('cancel_unclaimed_item');
    const fresh = detectAnomalies({ ...base, payouts: [payout({ status: 'UNCLAIMED' })] }, NOW);
    expect(fresh).toEqual([]);
    const old = detectAnomalies({ ...base, payouts: [payout({ status: 'UNCLAIMED', createdAt: '2026-11-07T18:30:00Z' })] }, NOW);
    expect(old[0].kind).toBe('unclaimed_aging');
  });
  it('flags two jobs at the same time in different places', () => {
    const other = job({ id: 'J-2', lat: 37.8, lng: -122.48, checkInAt: '2026-11-11T17:00:00Z', completedAt: '2026-11-11T19:00:00Z', status: 'paid' });
    const found = detectAnomalies({ workers: [worker], jobs: [...base.jobs, other], payouts: [] }, NOW);
    expect(found.map((f) => f.kind)).toEqual(['double_booking']);
  });
  it('keeps handled cards handled when detection runs again', () => {
    const state = { ...base, payouts: [payout(), payout({ id: 'P-2' })] };
    const first = mergeAnomalies([], detectAnomalies(state, NOW), NOW);
    first[0].status = 'actioned';
    const second = mergeAnomalies(first, detectAnomalies(state, NOW), NOW);
    expect(second).toHaveLength(1);
    expect(second[0].status).toBe('actioned');
  });
});

describe('seeded demo state', () => {
  const state = buildSeedState(NOW);
  it('has about 40 imported jobs over two weeks and three planted history anomalies', () => {
    const imported = state.jobs.filter((j) => j.source === 'imported');
    expect(imported.length).toBeGreaterThanOrEqual(40);
    const kinds = detectAnomalies(state, NOW).map((a) => a.kind);
    expect(kinds.filter((k) => k === 'duplicate_payout')).toHaveLength(3);
    expect(kinds).toContain('double_booking');
    expect(kinds).toContain('hours_spike');
  });
  it('is deterministic', () => {
    expect(buildSeedState(NOW)).toEqual(state);
  });
  it('plans a manual batch with a duplicate, an overpayment and a mistyped email', () => {
    const plan = manualBatchPlan();
    expect(plan.filter((p) => p.jobId === 'J-3001')).toHaveLength(2);
    expect(plan.find((p) => p.key === 'c')!.amount).toBe(640);
    expect(plan.find((p) => p.key === 'd')!.email).toBe(typoEmail());
    expect(editDistance(typoEmail(), state.workers[2].email)).toBeLessThanOrEqual(3);
  });
  it('builds dashboard tables whose totals agree with the payouts', () => {
    const t = buildTables({ ...state, anomalies: [] });
    const total = state.payouts.reduce((s, p) => s + p.amount, 0);
    expect(t.payouts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(total, 2);
    expect(t.cashflow.reduce((s, d) => s + d.moneyOut, 0)).toBeCloseTo(total, 2);
    expect(t.payouts.filter((p) => p.duplicate)).toHaveLength(3);
    expect(headline({ ...state, anomalies: [] }, NOW).unclaimed).toBe(0);
  });
});
