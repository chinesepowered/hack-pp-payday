// The record of what `pnpm seed` really created in the PayPal sandbox (batch and item ids, order
// ids). It is not secret. A copy lives in the repo (seed/paypal-seed.json) so a fresh deployment
// shows the same real payouts without paying them again, and the store holds the newest copy.

import committed from '@/seed/paypal-seed.json';
import { manualBatchPlan } from './seed-data';
import { getDoc, setDoc } from './store';
import type { AppState, Payout } from './types';

export type SeedItem = { key: string; senderItemId: string; itemId?: string; jobId: string; workerId: string; email: string; amount: number; status?: string; fee?: number; createdAt: string; completedAt?: string; batchId: string; transactionId?: string };
export type SeedRecord = {
  createdAt?: string;
  emailChangedAt?: string;
  items: SeedItem[];
  orders: { id: string; jobId: string; amount: number; fee: number; status: string; capturedAt: string }[];
};

const KEY = 'seed-paypal';

export async function readSeedRecord(): Promise<SeedRecord> {
  const stored = await getDoc<SeedRecord>(KEY);
  const repo = committed as SeedRecord;
  if (stored && (stored.items.length >= repo.items.length || !repo.items.length)) return stored;
  return repo;
}

export const writeSeedRecord = (record: SeedRecord) => setDoc(KEY, record);

/** Attaches the real seeded payouts and orders to a freshly generated state. */
export function applyLiveSeed(state: AppState, record: SeedRecord): AppState {
  if (!record.items.length) return state;
  const plan = manualBatchPlan();
  for (const item of record.items) {
    const job = state.jobs.find((j) => j.id === item.jobId);
    const payout: Payout = {
      id: item.senderItemId,
      jobId: item.jobId,
      workerId: item.workerId,
      email: item.email,
      amount: item.amount,
      fee: item.fee ?? 0,
      status: (item.status as Payout['status']) ?? 'PENDING',
      source: 'live',
      channel: 'manual batch',
      batchId: item.batchId,
      itemId: item.itemId,
      transactionId: item.transactionId,
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      secondsToPay: job?.completedAt && item.completedAt ? Math.max(1, Math.round((Date.parse(item.completedAt) - Date.parse(job.completedAt)) / 1000)) : undefined,
      note: plan.find((p) => p.key === item.key)?.note,
    };
    state.payouts.push(payout);
    if (job) job.status = 'paid';
  }
  for (const o of record.orders) {
    const job = state.jobs.find((j) => j.id === o.jobId);
    if (job) job.orderId = o.id;
    state.orders.push({ ...o, source: 'live' });
  }
  // Dario changed his payout email two hours before the manual batch went out.
  const dario = state.workers.find((w) => w.id === 'w2');
  if (dario && record.emailChangedAt) {
    dario.previousEmail = 'dario.silva@tidynest-crew.example';
    dario.emailChangedAt = record.emailChangedAt;
  }
  return state;
}
