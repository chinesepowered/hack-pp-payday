// The app's flows, shared by API routes, the seed script and the admin reset:
// verify a job, pay it through PayPal Payouts, refresh statuses from PayPal, run the watchdog,
// and carry out an operator-approved action.

import { complete, MODELS, parseJson, readPhoto } from './ai';
import { ctx, setFeature, stateKey } from './context';
import { cancelPayoutItem, createCapturedOrder, createPayoutBatch, getBalances, getPayoutBatch, getPayoutItem, PayPalError, type PayPalPayoutItem } from './paypal';
import { detectAnomalies, isDead, mergeAnomalies, payDecision, recordChecks, round2 } from './rules';
import { buildSeedState, todaysJobs } from './seed-data';
import { applyLiveSeed, readSeedRecord } from './seed-live';
import { getDoc, setDoc } from './store';
import type { ActionKind, Anomaly, AppState, Check, Job, Payout, PayoutStatus, TrailStep } from './types';

// --- State -----------------------------------------------------------------------------------

export async function loadState(): Promise<AppState> {
  const existing = await getDoc<AppState>(stateKey());
  if (existing) return existing;
  const fresh = await freshState();
  await saveState(fresh);
  return fresh;
}

export const saveState = (state: AppState) => setDoc(stateKey(), state);

/** The seeded demo state: generated history plus the payouts `pnpm seed` really sent, then the watchdog. */
export async function freshState(now = new Date()): Promise<AppState> {
  const state = applyLiveSeed(buildSeedState(now), await readSeedRecord());
  state.anomalies = mergeAnomalies([], detectAnomalies(state, now), now);
  return state;
}

/** Read-modify-write helper. */
export async function mutate<T>(fn: (state: AppState) => Promise<T> | T): Promise<T> {
  const state = await loadState();
  const out = await fn(state);
  await saveState(state);
  return out;
}

const trail = (steps: TrailStep[], step: string, detail: string, model?: string) => steps.push({ at: new Date().toISOString(), step, detail, model });

// --- 1. Job complete: verify -------------------------------------------------------------------

export async function verifyJob(jobId: string): Promise<Job> {
  setFeature('Verify job');
  const state = await loadState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`No job ${jobId}`);
  if (job.status !== 'scheduled' && job.status !== 'needs_review' && job.status !== 'submitted') return job;

  const now = Date.now();
  // The worker's phone supplies check-in and completion; in the demo they are stamped at submit time.
  if (!job.completedAt) {
    const length = job.hours * 3_600_000;
    job.scheduledEnd = new Date(now - 4 * 60_000).toISOString();
    job.scheduledStart = new Date(now - 4 * 60_000 - length).toISOString();
    job.checkInAt = new Date(Date.parse(job.scheduledStart) + 3 * 60_000).toISOString();
    job.checkInLat = job.lat + 0.0005;
    job.checkInLng = job.lng - 0.0004;
    job.completedAt = new Date(now).toISOString();
    job.demoClock = true;
  }
  job.status = 'submitted';

  const steps: TrailStep[] = [];
  trail(steps, 'Received', `${job.photos.length} photos and the checklist for a ${job.type.toLowerCase()} (${job.checklist.join(', ')}).`);

  // The vision model reads each photo. It only reports what it sees.
  let visionModel = MODELS.vision();
  const readings = await Promise.all(
    job.photos.map((p) =>
      readPhoto(p).catch((e) => ({ photo: p, room: 'unreadable', tidy: false, note: e instanceof Error ? e.message : 'The model did not answer.', model: MODELS.vision() })),
    ),
  );
  for (const r of readings) {
    visionModel = r.model;
    trail(steps, 'Photo read', `${r.photo.split('/').pop()}: ${r.room}${r.tidy ? ', looks clean' : ', not clean or unclear'}. ${r.note}`, r.model);
  }

  // Code compares the readings with the checklist and the job record.
  const checks: Check[] = job.checklist.map((room) => {
    const hit = readings.find((r) => r.room === room);
    return {
      id: `room:${room}`,
      label: `Photo of the ${room}`,
      pass: Boolean(hit?.tidy),
      detail: hit ? (hit.tidy ? hit.note : `The ${room} photo does not look clean: ${hit.note}`) : `No photo shows the ${room}.`,
      by: 'ai' as const,
    };
  });
  if (readings.some((r) => r.room === 'unreadable')) checks.push({ id: 'vision', label: 'Photos readable', pass: false, detail: 'The vision model could not read every photo.', by: 'ai' });
  checks.push(...recordChecks(job).map((c) => ({ ...c, by: 'rule' as const })));

  const failed = checks.filter((c) => !c.pass);
  const verdict = failed.length ? 'needs_review' : 'verified';
  trail(steps, 'Rules', failed.length ? `${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map((c) => c.label).join('; ')}.` : `All ${checks.length} checks passed.`);

  job.verification = {
    verdict,
    reasons: failed.length ? failed.map((c) => c.detail) : [`All ${job.checklist.length} required rooms are photographed and clean.`, 'Check-in time, time on site and location match the booking.'],
    checks,
    model: visionModel,
    at: new Date().toISOString(),
    trail: steps,
  };
  job.status = verdict;
  trail(steps, 'Verdict', verdict === 'verified' ? 'Verified. The job can be paid now.' : 'Needs review. An operator decides.');
  await saveState(state);
  return job;
}

// --- 2. Pay now ------------------------------------------------------------------------------

export async function availableBalance(): Promise<number | undefined> {
  try {
    const b = await getBalances();
    const usd = b.balances.find((x) => x.currency === 'USD');
    return usd ? Number(usd.available_balance.value) : undefined;
  } catch {
    return undefined; // Balances needs the Transaction search feature; never block a payout on a reporting error.
  }
}

export type PayResult = { ok: boolean; blocks: string[]; payout?: Payout; job: Job };

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export function applyItem(payout: Payout, item: PayPalPayoutItem, job?: Job) {
  payout.itemId = item.payout_item_id;
  payout.batchId = item.payout_batch_id;
  payout.transactionId = item.transaction_id;
  payout.status = item.transaction_status as PayoutStatus;
  if (item.payout_item_fee) payout.fee = Number(item.payout_item_fee.value);
  if (payout.status === 'SUCCESS' && !payout.completedAt) {
    // In Replay the recorded timestamps are old, so the local clock is used instead.
    payout.completedAt = ctx().mode === 'replay' ? new Date().toISOString() : item.time_processed ?? new Date().toISOString();
    if (job?.completedAt) payout.secondsToPay = Math.max(1, Math.round((Date.parse(payout.completedAt) - Date.parse(job.completedAt)) / 1000));
  }
}

/** Pays one or more verified jobs in a single PayPal batch, after the rules allow each one. */
export async function payJobs(jobIds: string[], opts: { operatorOverride?: boolean } = {}): Promise<PayResult[]> {
  setFeature(jobIds.length > 1 ? 'Pay batch' : 'Pay now');
  const state = await loadState();
  const balance = await availableBalance();
  const results: PayResult[] = [];
  const toSend: { job: Job; payout: Payout }[] = [];
  let running = balance;

  for (const id of jobIds) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) continue;
    const worker = state.workers.find((w) => w.id === job.workerId);
    // An operator may approve a job that needed review; every money rule still applies.
    if (opts.operatorOverride && job.status === 'needs_review') {
      job.status = 'verified';
      job.verification?.trail.push({ at: new Date().toISOString(), step: 'Operator', detail: 'Approved by the operator after review.' });
    }
    const decision = payDecision(job, worker, state, { availableBalance: running });
    if (!decision.ok || !worker) {
      results.push({ ok: false, blocks: decision.blocks, job });
      continue;
    }
    if (running !== undefined) running = round2(running - decision.amount);
    const payout: Payout = {
      id: `PD-${job.id}-${uid()}`,
      jobId: job.id,
      workerId: worker.id,
      email: worker.email,
      amount: decision.amount,
      fee: 0,
      status: 'PENDING',
      source: 'live',
      channel: 'payday',
      createdAt: new Date().toISOString(),
      note: `${job.id} ${job.type}`,
    };
    toSend.push({ job, payout });
  }

  if (toSend.length) {
    const batchKey = `payday-${toSend.map((t) => t.payout.id).join('+').slice(0, 100)}`;
    try {
      const batch = await createPayoutBatch(batchKey, toSend.map(({ payout }) => ({ senderItemId: payout.id, email: payout.email, amount: payout.amount, note: payout.note ?? payout.jobId })));
      for (const { job, payout } of toSend) {
        payout.batchId = batch.batch_header.payout_batch_id;
        state.payouts.push(payout);
        job.status = 'paid';
        job.verification?.trail.push({ at: new Date().toISOString(), step: 'Payout', detail: `Sent $${payout.amount.toFixed(2)} to ${payout.email} in PayPal batch ${payout.batchId}.` });
        results.push({ ok: true, blocks: [], payout, job });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'PayPal rejected the batch.';
      for (const { job } of toSend) results.push({ ok: false, blocks: [message], job });
    }
  }
  await saveState(state);
  // Money in: the customer's card is charged for the job as it is paid out (Orders API).
  for (const { job } of toSend.filter((t) => state.payouts.includes(t.payout))) await chargeCustomer(job.id).catch((e) => console.warn('[order]', e instanceof Error ? e.message : e));
  return results;
}

export async function chargeCustomer(jobId: string) {
  const state = await loadState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.orderId) return;
  const order = await createCapturedOrder(`${job.id}-${state.seededAt.slice(0, 19)}`, job.customerPrice, `TidyNest ${job.type.toLowerCase()}`);
  await mutate((s) => {
    const j = s.jobs.find((x) => x.id === jobId);
    if (!j || j.orderId) return;
    j.orderId = order.id;
    s.orders.push({ id: order.id, jobId, amount: order.amount, fee: order.fee, status: order.status, source: 'live', capturedAt: new Date().toISOString() });
  });
}

// --- Refresh from PayPal (polling; webhooks call the same code) ---------------------------------

const SETTLED: PayoutStatus[] = ['SUCCESS', 'FAILED', 'RETURNED', 'CANCELED', 'REFUNDED', 'REVERSED', 'BLOCKED'];

/** Re-reads live payouts from PayPal. `all` also re-reads unclaimed items, which can change at any time. */
export async function refreshPayouts(opts: { payoutId?: string; all?: boolean } = {}): Promise<AppState> {
  const state = await loadState();
  const targets = state.payouts.filter(
    (p) => p.source === 'live' && p.batchId && (opts.payoutId ? p.id === opts.payoutId : opts.all ? !SETTLED.includes(p.status) : p.status === 'PENDING' || !p.itemId),
  );
  if (!targets.length) return state;
  const fetched = new Map<string, PayPalPayoutItem[]>();
  for (const batchId of new Set(targets.map((p) => p.batchId!))) {
    try {
      fetched.set(batchId, (await getPayoutBatch(batchId)).items ?? []);
    } catch (e) {
      console.warn('[refresh]', e instanceof Error ? e.message : e);
    }
  }
  // Apply onto the latest state, so a slow PayPal read cannot overwrite a concurrent change.
  return mutate((latest) => {
    const replay = ctx().mode === 'replay';
    for (const p of latest.payouts) {
      const items = p.batchId ? fetched.get(p.batchId) : undefined;
      if (!items || !targets.some((t) => t.id === p.id)) continue;
      // Replay answers every batch read with the one recorded batch, so match by position there.
      const item = items.find((i) => i.payout_item.sender_item_id === p.id) ?? (replay ? items[0] : undefined);
      if (item) applyItem(p, replay ? { ...item, payout_item_id: p.itemId ?? item.payout_item_id } : item, latest.jobs.find((j) => j.id === p.jobId));
    }
    latest.anomalies = mergeAnomalies(latest.anomalies, detectAnomalies(latest));
    return latest;
  });
}

/** Applies one payout item (from a webhook or a single item read) to the stored payout. */
export async function syncItem(itemId: string): Promise<boolean> {
  const item = await getPayoutItem(itemId);
  return mutate((state) => {
    const payout = state.payouts.find((p) => p.itemId === item.payout_item_id || p.id === item.payout_item?.sender_item_id);
    if (!payout) return false;
    applyItem(payout, item, state.jobs.find((j) => j.id === payout.jobId));
    state.anomalies = mergeAnomalies(state.anomalies, detectAnomalies(state));
    return true;
  });
}

// --- 3. Watchdog -----------------------------------------------------------------------------

/** Runs the rules, then has the model explain each new card and draft the note to the worker. */
export async function runWatchdog(opts: { explain?: boolean } = {}): Promise<Anomaly[]> {
  setFeature('Watchdog');
  const state = await loadState();
  state.anomalies = mergeAnomalies(state.anomalies, detectAnomalies(state));
  await saveState(state);
  if (opts.explain === false) return state.anomalies;

  const pending = state.anomalies.filter((a) => !a.ai).slice(0, 8);
  // A slow model must not stall the watchdog: a card that is not explained in time keeps its evidence
  // and is explained on the next run.
  const within = <T,>(ms: number, work: Promise<T | null>) => Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const explained = await Promise.all(
    pending.map((a) => within(40_000, (async () => {
      const worker = state.workers.find((w) => w.id === a.workerId);
      try {
        const { text, model } = await complete(
          `anomaly:${a.id}`,
          MODELS.text(),
          [
            {
              role: 'system',
              content:
                'You are the payout auditor for TidyNest, a home cleaning marketplace. You explain payout anomalies to the operator in plain words. ' +
                'Use only the evidence given. Never invent amounts or dates. Do not use em dashes. Reply with JSON only: ' +
                '{"summary": "two short sentences for the operator, about the worker in the third person: what happened and why it matters", "message": "a short, polite message to the worker asking them to confirm or explaining the next step"}',
            },
            { role: 'user', content: JSON.stringify({ kind: a.kind, title: a.title, worker: worker?.name, amountAtRisk: a.amountAtRisk, evidence: a.evidence, suggestedAction: a.suggestedAction }) },
          ],
          1500,
        );
        const parsed = parseJson<{ summary?: string; message?: string }>(text);
        const clean = (s?: string) => (s ?? '').replace(/[\u2013\u2014]/g, ', ').trim();
        if (!parsed?.summary) return null;
        return { id: a.id, ai: { summary: clean(parsed.summary), message: clean(parsed.message), model } };
      } catch {
        return null;
      }
    })())),
  );
  return mutate((latest) => {
    for (const e of explained) {
      const target = e && latest.anomalies.find((a) => a.id === e.id);
      if (target && e) target.ai = e.ai;
    }
    return latest.anomalies;
  });
}

/** Carries out the action the operator approved on an anomaly card. */
export async function actOnAnomaly(anomalyId: string, action: ActionKind | 'dismiss'): Promise<{ anomaly: Anomaly; detail: string }> {
  setFeature('Anomaly action');
  const state = await loadState();
  const anomaly = state.anomalies.find((a) => a.id === anomalyId);
  if (!anomaly) throw new Error('That anomaly no longer exists.');
  const worker = state.workers.find((w) => w.id === anomaly.workerId);
  let detail = '';

  if (action === 'dismiss') {
    anomaly.status = 'dismissed';
    detail = 'Dismissed by the operator.';
  } else if (action === 'hold_next_payout') {
    if (!worker) throw new Error('Unknown worker.');
    worker.onHold = true;
    worker.holdReason = anomaly.title;
    detail = `Next payouts to ${worker.name} are held until the operator releases them.`;
    anomaly.status = 'actioned';
  } else if (action === 'message_worker') {
    if (!worker) throw new Error('Unknown worker.');
    const text = anomaly.ai?.message || `Hi ${worker.name.split(' ')[0]}, we are checking a payout on your account (${anomaly.title.toLowerCase()}). Could you confirm the details with TidyNest support?`;
    state.messages.push({ id: `M-${uid()}`, workerId: worker.id, at: new Date().toISOString(), text, anomalyId });
    detail = `Message sent to ${worker.name} in the worker app.`;
    anomaly.status = 'actioned';
  } else if (action === 'cancel_unclaimed_item') {
    const payout = state.payouts.find((p) => anomaly.payoutIds.includes(p.id) && p.status === 'UNCLAIMED');
    if (!payout) throw new Error('No unclaimed payout is left on this card.');
    if (!payout.itemId) throw new Error('This payout is imported history and has no live PayPal item to cancel.');
    try {
      const item = await cancelPayoutItem(payout.itemId);
      applyItem(payout, item);
      if (payout.status !== 'RETURNED' && payout.status !== 'CANCELED') payout.status = 'RETURNED';
    } catch (e) {
      // PayPal is the source of truth: re-read the item and show what it is now. Nothing is assumed.
      if (e instanceof PayPalError) {
        const item = await getPayoutItem(payout.itemId).catch(() => null);
        if (item) applyItem(payout, item);
        await saveState(state);
        if (payout.status === 'UNCLAIMED')
          throw new Error(
            `PayPal did not cancel the item (HTTP ${e.status}${(e.body as { name?: string } | null)?.name ? ` ${(e.body as { name?: string }).name}` : ''}, debug id ${e.debugId}). ` +
              `Nothing changed: item ${payout.itemId} is still UNCLAIMED and the money is still reserved. Try again later, or hold the next payout meanwhile.`,
          );
      }
      throw e;
    }
    const job = state.jobs.find((j) => j.id === payout.jobId);
    if (job) job.status = 'verified'; // the worker is still owed this job
    detail = `PayPal cancelled item ${payout.itemId}: $${payout.amount.toFixed(2)} is back in the TidyNest balance. ${job ? `${job.id} can be paid again to the email on file.` : ''}`;
    anomaly.status = 'actioned';
  }
  anomaly.resolution = { action, at: new Date().toISOString(), detail };
  await saveState(state);
  return { anomaly, detail };
}

export async function releaseHold(workerId: string) {
  return mutate((state) => {
    const w = state.workers.find((x) => x.id === workerId);
    if (w) {
      w.onHold = false;
      w.holdReason = undefined;
    }
    return w;
  });
}

/** Adds a fresh set of today's jobs, so the demo never runs out of work to complete. */
export async function addDemoJobs() {
  return mutate((state) => {
    const round = state.jobs.filter((j) => j.id.startsWith('J-4001')).length;
    const fresh = todaysJobs(new Date(), round);
    state.jobs.push(...fresh);
    return fresh;
  });
}

export const livePayoutsOpen = (state: AppState) => state.payouts.filter((p) => p.source === 'live' && !isDead(p));
