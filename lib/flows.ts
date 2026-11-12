// The app's flows, shared by API routes, the seed script and the admin reset:
// verify a job, pay it through PayPal Payouts, refresh statuses from PayPal, run the watchdog,
// and carry out an operator-approved action.
//
// Concurrency: several requests run at once (a worker submitting, the desk polling, a webhook).
// No flow ever saves a whole state it loaded earlier. Slow work (the model, PayPal) happens on a
// snapshot, and every change is then applied to the latest state inside mutate(), which writes
// only if nobody else wrote in between and otherwise re-applies the change to the newer state.

import { complete, MODELS, parseJson, readPhoto } from './ai';
import { ctx, setFeature, stateKey } from './context';
import { cancelPayoutItem, createCapturedOrder, createPayoutBatch, getBalances, getPayoutBatch, getPayoutItem, PayPalError, type PayPalPayoutItem } from './paypal';
import { detectAnomalies, isDead, mergeAnomalies, payDecision, recordChecks, round2 } from './rules';
import { buildSeedState, todaysJobs } from './seed-data';
import { applyLiveSeed, readSeedRecord } from './seed-live';
import { setDoc, updateDoc } from './store';
import type { ActionKind, Anomaly, AppState, Check, Job, Payout, PayoutStatus, TrailStep, Verification } from './types';

// --- State -----------------------------------------------------------------------------------

/** The seeded demo state: generated history plus the payouts `pnpm seed` really sent, then the watchdog. */
export async function freshState(now = new Date()): Promise<AppState> {
  const state = applyLiveSeed(buildSeedState(now), await readSeedRecord());
  state.anomalies = mergeAnomalies([], detectAnomalies(state, now), now);
  return state;
}

/**
 * The current state, for reading. A fresh state is created only when the document truly does not
 * exist; a failed read throws and fails the request instead.
 */
export function loadState(): Promise<AppState> {
  return updateDoc<AppState, AppState>(stateKey(), async (current) => {
    if (current) return { doc: current, result: current, save: false };
    const fresh = await freshState();
    return { doc: fresh, result: fresh };
  });
}

/** Deliberate overwrite of the whole state: the admin reset and the seed. Nothing else may use it. */
export const resetState = (state: AppState) => setDoc(stateKey(), state);

/**
 * Applies a change to the latest state and saves it, without losing a concurrent request's work.
 * `fn` may run more than once (on a newer state each time), so it must only touch the state it is
 * given and must not call PayPal or the model.
 */
export function mutate<T>(fn: (state: AppState) => T): Promise<T> {
  return updateDoc<AppState, T>(stateKey(), async (current) => {
    const state = current ?? (await freshState());
    return { doc: state, result: fn(state) };
  });
}

const trail = (steps: TrailStep[], step: string, detail: string, model?: string) => steps.push({ at: new Date().toISOString(), step, detail, model });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const OPEN_FOR_VERIFY: Job['status'][] = ['scheduled', 'submitted', 'needs_review'];

// --- 1. Job complete: verify -------------------------------------------------------------------

export async function verifyJob(jobId: string): Promise<Job> {
  setFeature('Verify job');

  // Step 1, on the latest state: mark the job submitted and stamp the visit.
  const claim = await mutate((state) => {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    if (!OPEN_FOR_VERIFY.includes(job.status)) return { job: clone(job), open: false };
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
    return { job: clone(job), open: true };
  });
  if (!claim) throw new Error(`No job ${jobId}`);
  if (!claim.open) return claim.job;
  const job = claim.job; // a snapshot: the slow work below never writes it back as a whole

  // Step 2, no state held: the vision model reads each photo. It only reports what it sees.
  const steps: TrailStep[] = [];
  trail(steps, 'Received', `${job.photos.length} photos and the checklist for a ${job.type.toLowerCase()} (${job.checklist.join(', ')}).`);
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
  trail(steps, 'Verdict', verdict === 'verified' ? 'Verified. The job can be paid now.' : 'Needs review. An operator decides.');
  const verification: Verification = {
    verdict,
    reasons: failed.length ? failed.map((c) => c.detail) : [`All ${job.checklist.length} required rooms are photographed and clean.`, 'Check-in time, time on site and location match the booking.'],
    checks,
    model: visionModel,
    at: new Date().toISOString(),
    trail: steps,
  };

  // Step 3, on the latest state again: record the verdict on this one job.
  return mutate((state) => {
    const latest = state.jobs.find((j) => j.id === jobId);
    if (!latest) throw new Error(`No job ${jobId}`);
    // If the job moved on meanwhile (an operator paid it, say), the newer status wins.
    if (OPEN_FOR_VERIFY.includes(latest.status)) {
      latest.verification = verification;
      latest.status = verdict;
    }
    return clone(latest);
  });
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

/**
 * Decides, on the given state, which of the jobs may be paid, and reserves each one: the payout is
 * recorded as PENDING and the job marked paid in the same atomic change, before PayPal is called.
 * A second request for the same job then meets the duplicate guard, however the two interleave.
 */
export function reservePayouts(state: AppState, jobIds: string[], opts: { operatorOverride?: boolean; availableBalance?: number } = {}) {
  const blocked: PayResult[] = [];
  const reserved: Payout[] = [];
  let running = opts.availableBalance;
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
      blocked.push({ ok: false, blocks: decision.blocks, job: clone(job) });
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
    state.payouts.push(payout);
    job.status = 'paid';
    reserved.push(clone(payout));
  }
  return { blocked, reserved };
}

/** Pays one or more verified jobs in a single PayPal batch, after the rules allow each one. */
export async function payJobs(jobIds: string[], opts: { operatorOverride?: boolean } = {}): Promise<PayResult[]> {
  setFeature(jobIds.length > 1 ? 'Pay batch' : 'Pay now');
  const balance = await availableBalance();

  // Step 1, on the latest state: check the rules and reserve.
  const { blocked, reserved } = await mutate((state) => reservePayouts(state, jobIds, { ...opts, availableBalance: balance }));
  if (!reserved.length) return blocked;

  // Step 2, no state held: one PayPal batch. The batch id doubles as the idempotency key.
  const batchKey = `payday-${reserved.map((p) => p.id).join('+').slice(0, 100)}`;
  let batchId: string | null = null;
  let failure = '';
  try {
    const batch = await createPayoutBatch(batchKey, reserved.map((p) => ({ senderItemId: p.id, email: p.email, amount: p.amount, note: p.note ?? p.jobId })));
    batchId = batch.batch_header.payout_batch_id;
  } catch (e) {
    failure = e instanceof Error ? e.message : 'PayPal rejected the batch.';
  }

  // Step 3, on the latest state: attach the PayPal batch, or release the reservation.
  const settled = await mutate((state) => {
    const out: PayResult[] = [];
    for (const r of reserved) {
      const payout = state.payouts.find((p) => p.id === r.id);
      const job = state.jobs.find((j) => j.id === r.jobId);
      if (!job) continue;
      if (batchId && payout) {
        payout.batchId = batchId;
        job.verification?.trail.push({ at: new Date().toISOString(), step: 'Payout', detail: `Sent $${payout.amount.toFixed(2)} to ${payout.email} in PayPal batch ${batchId}.` });
        out.push({ ok: true, blocks: [], payout: clone(payout), job: clone(job) });
      } else {
        // PayPal took nothing: remove the reservation so the job can be paid later.
        state.payouts = state.payouts.filter((p) => p.id !== r.id);
        if (job.status === 'paid' && !state.payouts.some((p) => p.jobId === job.id && !isDead(p))) job.status = 'verified';
        out.push({ ok: false, blocks: [failure || 'The payout could not be recorded.'], job: clone(job) });
      }
    }
    return out;
  });

  // Money in: the customer's card is charged for the job as it is paid out (Orders API).
  for (const r of settled.filter((s) => s.ok)) await chargeCustomer(r.job.id).catch((e) => console.warn('[order]', e instanceof Error ? e.message : e));
  return [...blocked, ...settled];
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
  // Only the payout fields PayPal reported are applied, onto the latest state.
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
  const state = await mutate((s) => {
    s.anomalies = mergeAnomalies(s.anomalies, detectAnomalies(s));
    return s;
  });
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
        const clean = (s?: string) => (s ?? '').replace(/[–—]/g, ', ').trim();
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

  // Cancelling calls PayPal first, on a snapshot; the result is then applied to the latest state.
  let cancelled: { payoutId: string; item: PayPalPayoutItem } | null = null;
  if (action === 'cancel_unclaimed_item') {
    const snapshot = await loadState();
    const card = snapshot.anomalies.find((a) => a.id === anomalyId);
    if (!card) throw new Error('That anomaly no longer exists.');
    const payout = snapshot.payouts.find((p) => card.payoutIds.includes(p.id) && p.status === 'UNCLAIMED');
    if (!payout) throw new Error('No unclaimed payout is left on this card.');
    if (!payout.itemId) throw new Error('This payout is imported history and has no live PayPal item to cancel.');
    const { id: payoutId, itemId } = payout;
    try {
      cancelled = { payoutId, item: await cancelPayoutItem(itemId) };
    } catch (e) {
      // PayPal is the source of truth: re-read the item and show what it is now. Nothing is assumed.
      if (e instanceof PayPalError) {
        const item = await getPayoutItem(itemId).catch(() => null);
        const status = item
          ? await mutate((state) => {
              const p = state.payouts.find((x) => x.id === payoutId);
              if (p) applyItem(p, item, state.jobs.find((j) => j.id === p.jobId));
              return p?.status;
            })
          : payout.status;
        if (status === 'UNCLAIMED')
          throw new Error(
            `PayPal did not cancel the item (HTTP ${e.status}${(e.body as { name?: string } | null)?.name ? ` ${(e.body as { name?: string }).name}` : ''}, debug id ${e.debugId}). ` +
              `Nothing changed: item ${itemId} is still UNCLAIMED and the money is still reserved. Try again later, or hold the next payout meanwhile.`,
          );
      }
      throw e;
    }
  }

  return mutate((state) => {
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
    } else if (cancelled) {
      const done = cancelled;
      const payout = state.payouts.find((p) => p.id === done.payoutId);
      if (!payout) throw new Error('The payout on this card no longer exists.');
      applyItem(payout, done.item);
      if (payout.status !== 'RETURNED' && payout.status !== 'CANCELED') payout.status = 'RETURNED';
      const job = state.jobs.find((j) => j.id === payout.jobId);
      if (job) job.status = 'verified'; // the worker is still owed this job
      detail = `PayPal cancelled item ${payout.itemId}: $${payout.amount.toFixed(2)} is back in the TidyNest balance. ${job ? `${job.id} can be paid again to the email on file.` : ''}`;
      anomaly.status = 'actioned';
    }
    anomaly.resolution = { action, at: new Date().toISOString(), detail };
    return { anomaly: clone(anomaly), detail };
  });
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
