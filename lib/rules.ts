// Deterministic money rules and the watchdog. No model output is trusted here: the AI proposes
// (a verification verdict, an anomaly explanation), this code decides whether money may move.

import type { Anomaly, AnomalyKind, AppState, Job, Payout, Worker } from './types';

export const LIMITS = {
  maxSinglePayout: 500, // USD, hard cap for an automatic payout
  rateTolerance: 1.15, // payout may exceed rate x hours by 15% at most (rounding, supplies)
  overpaymentFactor: 1.25, // watchdog flags a payout above 125% of the job amount
  emailChangeWindowHours: 24,
  emailChangeHoldAmount: 100, // automatic payouts at or above this are held after a recent email change
  unclaimedAgeHours: 72,
  checkInGraceMinutes: 20,
  minDurationShare: 0.6,
  maxCheckInDistanceMeters: 300,
  hoursSpikeFactor: 2.2,
  hoursSpikeMinimum: 10,
  doubleBookingMeters: 1000,
};

const DEAD: Payout['status'][] = ['FAILED', 'CANCELED', 'RETURNED', 'REVERSED', 'REFUNDED', 'BLOCKED'];
export const isDead = (p: Payout) => DEAD.includes(p.status);
export const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
}

export function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// --- Record checks for verification (the vision model only reports which rooms it sees) ----

export function recordChecks(job: Job) {
  const out: { id: string; label: string; pass: boolean; detail: string }[] = [];
  if (job.checkInAt) {
    const late = (new Date(job.checkInAt).getTime() - new Date(job.scheduledStart).getTime()) / 60_000;
    out.push({
      id: 'check-in-time',
      label: 'Check-in against schedule',
      pass: Math.abs(late) <= LIMITS.checkInGraceMinutes,
      detail: `Checked in ${Math.abs(Math.round(late))} min ${late >= 0 ? 'after' : 'before'} the scheduled start (allowed: ${LIMITS.checkInGraceMinutes} min).`,
    });
  } else out.push({ id: 'check-in-time', label: 'Check-in against schedule', pass: false, detail: 'No check-in was recorded.' });

  if (job.checkInAt && job.completedAt) {
    const worked = hoursBetween(job.checkInAt, job.completedAt);
    out.push({
      id: 'duration',
      label: 'Time on site',
      pass: worked >= job.hours * LIMITS.minDurationShare,
      detail: `${worked.toFixed(1)} h on site for a ${job.hours} h booking (minimum ${(job.hours * LIMITS.minDurationShare).toFixed(1)} h).`,
    });
  }
  if (job.checkInLat !== undefined && job.checkInLng !== undefined) {
    const meters = distanceMeters(job.lat, job.lng, job.checkInLat, job.checkInLng);
    out.push({
      id: 'location',
      label: 'Check-in location',
      pass: meters <= LIMITS.maxCheckInDistanceMeters,
      detail: `Checked in ${Math.round(meters)} m from the customer's address (allowed: ${LIMITS.maxCheckInDistanceMeters} m).`,
    });
  }
  return out;
}

// --- Pay decision ----------------------------------------------------------------------------

export type PayDecision = { ok: boolean; amount: number; blocks: string[] };

/** May this job be paid automatically right now? Every rule is checked before PayPal is called. */
export function payDecision(job: Job, worker: Worker | undefined, state: Pick<AppState, 'payouts'>, opts: { availableBalance?: number; now?: Date } = {}): PayDecision {
  const now = opts.now ?? new Date();
  const blocks: string[] = [];
  const amount = round2(job.amount);
  if (!worker) blocks.push('The worker on this job is unknown.');
  if (job.status !== 'verified') blocks.push(`Job is ${job.status.replace('_', ' ')}, not verified.`);
  if (state.payouts.some((p) => p.jobId === job.id && !isDead(p))) blocks.push('This job already has a payout. A second one would be a duplicate.');
  if (!(amount > 0)) blocks.push('The payout amount must be above zero.');
  if (amount > LIMITS.maxSinglePayout) blocks.push(`Amount $${amount.toFixed(2)} is above the $${LIMITS.maxSinglePayout} cap for automatic payouts.`);
  if (worker && amount > round2(worker.hourlyRate * job.hours * LIMITS.rateTolerance))
    blocks.push(`Amount $${amount.toFixed(2)} is above the worker's rate ($${worker.hourlyRate}/h x ${job.hours} h, plus 15%).`);
  if (worker?.onHold) blocks.push(`Payouts to ${worker.name} are on hold: ${worker.holdReason ?? 'operator hold'}.`);
  if (worker?.emailChangedAt && amount >= LIMITS.emailChangeHoldAmount && hoursBetween(worker.emailChangedAt, now.toISOString()) < LIMITS.emailChangeWindowHours)
    blocks.push(`Payout email changed in the last ${LIMITS.emailChangeWindowHours} h. Payouts of $${LIMITS.emailChangeHoldAmount} or more wait for the operator.`);
  if (opts.availableBalance !== undefined && amount > opts.availableBalance)
    blocks.push(`The PayPal balance ($${opts.availableBalance.toFixed(2)}) does not cover $${amount.toFixed(2)}.`);
  return { ok: blocks.length === 0, amount, blocks };
}

/** Would a batch exceed the available balance? Used to warn before the batch is sent. */
export function balanceWarning(total: number, available: number | undefined) {
  if (available === undefined) return null;
  if (total > available) return `This batch ($${total.toFixed(2)}) exceeds the available PayPal balance ($${available.toFixed(2)}).`;
  if (total > available * 0.8) return `This batch uses more than 80% of the available PayPal balance ($${available.toFixed(2)}).`;
  return null;
}

// --- Watchdog --------------------------------------------------------------------------------

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });

type Found = Omit<Anomaly, 'status' | 'detectedAt'>;

export function detectAnomalies(state: Pick<AppState, 'workers' | 'jobs' | 'payouts'>, now: Date = new Date()): Found[] {
  const found: Found[] = [];
  const worker = (id: string) => state.workers.find((w) => w.id === id);
  const job = (id: string) => state.jobs.find((j) => j.id === id);
  const name = (id: string) => worker(id)?.name ?? id;
  const make = (kind: AnomalyKind, key: string, rest: Omit<Found, 'id' | 'kind'>) => found.push({ id: `${kind}:${key}`, kind, ...rest });

  // 1. Duplicate payout for the same job.
  const byJob = new Map<string, Payout[]>();
  for (const p of state.payouts) if (!isDead(p)) byJob.set(p.jobId, [...(byJob.get(p.jobId) ?? []), p]);
  for (const [jobId, list] of byJob) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const extra = sorted.slice(1);
    make('duplicate_payout', jobId, {
      severity: 'high',
      title: `Duplicate payout to ${name(sorted[0].workerId)}`,
      workerId: sorted[0].workerId,
      payoutIds: sorted.map((p) => p.id),
      jobIds: [jobId],
      amountAtRisk: round2(extra.reduce((s, p) => s + p.amount, 0)),
      evidence: [
        { label: 'Job', value: `${jobId} (${job(jobId)?.type ?? 'job'}, ${money(job(jobId)?.amount ?? 0)})` },
        ...sorted.map((p, i) => ({ label: i === 0 ? 'First payout' : `Payout ${i + 1}`, value: `${money(p.amount)} on ${when(p.createdAt)} via ${p.channel}${p.itemId ? `, item ${p.itemId}` : ''}` })),
      ],
      suggestedAction: 'hold_next_payout',
    });
  }

  for (const p of state.payouts) {
    if (isDead(p)) continue;
    const j = job(p.jobId);
    const w = worker(p.workerId);

    // 2. Amount far above the job's rate.
    if (j && p.amount > j.amount * LIMITS.overpaymentFactor) {
      make('overpayment', p.id, {
        severity: 'high',
        title: `Overpayment to ${name(p.workerId)}`,
        workerId: p.workerId,
        payoutIds: [p.id],
        jobIds: [j.id],
        amountAtRisk: round2(p.amount - j.amount),
        evidence: [
          { label: 'Paid', value: `${money(p.amount)} on ${when(p.createdAt)} via ${p.channel}` },
          { label: 'Job amount', value: `${money(j.amount)} (${j.hours} h at $${w?.hourlyRate ?? '?'}/h)` },
          { label: 'Ratio', value: `${(p.amount / j.amount).toFixed(1)}x the job amount` },
        ],
        suggestedAction: 'hold_next_payout',
      });
    }

    // 5. Unclaimed payouts getting old, or sent to an email that looks mistyped.
    if (p.status === 'UNCLAIMED') {
      const age = hoursBetween(p.createdAt, now.toISOString());
      const onFile = w?.email ?? '';
      const distance = onFile && p.email !== onFile ? editDistance(p.email, onFile) : 0;
      const typo = distance > 0 && distance <= 3;
      if (age >= LIMITS.unclaimedAgeHours || typo) {
        make('unclaimed_aging', p.id, {
          severity: typo ? 'high' : 'medium',
          title: typo ? `Unclaimed payout: email looks mistyped` : `Unclaimed payout getting old`,
          workerId: p.workerId,
          payoutIds: [p.id],
          jobIds: [p.jobId],
          amountAtRisk: p.amount,
          evidence: [
            { label: 'Sent to', value: p.email },
            ...(typo ? [{ label: 'Email on file', value: `${onFile} (${distance} character${distance === 1 ? '' : 's'} different)` }] : []),
            { label: 'Status', value: `UNCLAIMED for ${age < 48 ? `${Math.max(0, age).toFixed(1)} h` : `${(age / 24).toFixed(1)} days`}${p.itemId ? `, item ${p.itemId}` : ''}` },
            { label: 'Amount', value: money(p.amount) },
          ],
          suggestedAction: 'cancel_unclaimed_item',
        });
      }
    }
  }

  // 3. Payout email changed right before a payout (one card per change, covering every payout in the window).
  for (const w of state.workers) {
    if (!w.emailChangedAt) continue;
    const hit = state.payouts
      .filter((p) => !isDead(p) && p.workerId === w.id && p.email === w.email)
      .filter((p) => {
        const gap = hoursBetween(w.emailChangedAt!, p.createdAt);
        return gap >= 0 && gap < LIMITS.emailChangeWindowHours;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!hit.length) continue;
    const total = round2(hit.reduce((s, p) => s + p.amount, 0));
    const gap = hoursBetween(w.emailChangedAt, hit[0].createdAt);
    make('email_change', `${w.id}:${w.emailChangedAt}`, {
      severity: total >= LIMITS.emailChangeHoldAmount ? 'high' : 'medium',
      title: `Payout email changed before paying ${w.name}`,
      workerId: w.id,
      payoutIds: hit.map((p) => p.id),
      jobIds: hit.map((p) => p.jobId),
      amountAtRisk: total,
      evidence: [
        { label: 'Email changed', value: `${when(w.emailChangedAt)}, ${gap < 1 ? `${Math.round(gap * 60)} min` : `${gap.toFixed(1)} h`} before the first payout` },
        { label: 'Old email', value: w.previousEmail ?? 'unknown' },
        { label: 'New email', value: w.email },
        { label: 'Paid to new email', value: `${money(total)} in ${hit.length} payout${hit.length === 1 ? '' : 's'}` },
      ],
      suggestedAction: 'message_worker',
    });
  }

  // 4. Two jobs at the same time in different places.
  const worked = state.jobs.filter((j) => j.checkInAt && j.completedAt);
  // Jobs completed in the demo get their times stamped at submit, so they are left out of the overlap rule.
  const clocked = worked.filter((j) => !j.demoClock);
  for (const w of state.workers) {
    const mine = clocked.filter((j) => j.workerId === w.id).sort((a, b) => a.checkInAt!.localeCompare(b.checkInAt!));
    for (let i = 0; i < mine.length; i++)
      for (let k = i + 1; k < mine.length; k++) {
        const a = mine[i];
        const b = mine[k];
        if (b.checkInAt! >= a.completedAt!) break;
        const meters = distanceMeters(a.lat, a.lng, b.lat, b.lng);
        if (meters < LIMITS.doubleBookingMeters) continue;
        const overlap = (Math.min(Date.parse(a.completedAt!), Date.parse(b.completedAt!)) - Date.parse(b.checkInAt!)) / 60_000;
        make('double_booking', `${a.id}+${b.id}`, {
          severity: 'medium',
          title: `${w.name} was in two places at once`,
          workerId: w.id,
          payoutIds: state.payouts.filter((p) => p.jobId === a.id || p.jobId === b.id).map((p) => p.id),
          jobIds: [a.id, b.id],
          amountAtRisk: Math.min(a.amount, b.amount),
          evidence: [
            { label: a.id, value: `${a.address}, ${when(a.checkInAt!)} to ${when(a.completedAt!)}` },
            { label: b.id, value: `${b.address}, ${when(b.checkInAt!)} to ${when(b.completedAt!)}` },
            { label: 'Overlap', value: `${Math.round(overlap)} min, ${(meters / 1000).toFixed(1)} km apart` },
          ],
          suggestedAction: 'message_worker',
        });
      }
  }

  // 6. A sudden spike in one worker's hours.
  for (const w of state.workers) {
    const perDay = new Map<string, { hours: number; jobs: string[] }>();
    for (const j of worked.filter((x) => x.workerId === w.id)) {
      const day = new Date(Date.parse(j.scheduledStart) - 8 * 3_600_000).toISOString().slice(0, 10); // Pacific day
      const d = perDay.get(day) ?? { hours: 0, jobs: [] };
      perDay.set(day, { hours: d.hours + j.hours, jobs: [...d.jobs, j.id] });
    }
    const days = [...perDay.entries()];
    if (days.length < 4) continue;
    const sorted = days.map(([, d]) => d.hours).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const [day, d] of days) {
      if (d.hours >= LIMITS.hoursSpikeMinimum && d.hours > median * LIMITS.hoursSpikeFactor) {
        make('hours_spike', `${w.id}:${day}`, {
          severity: 'low',
          title: `Hours spike for ${w.name}`,
          workerId: w.id,
          payoutIds: state.payouts.filter((p) => d.jobs.includes(p.jobId)).map((p) => p.id),
          jobIds: d.jobs,
          amountAtRisk: round2(d.jobs.reduce((s, id) => s + (job(id)?.amount ?? 0), 0)),
          evidence: [
            { label: 'Day', value: day },
            { label: 'Hours that day', value: `${d.hours} h across ${d.jobs.length} jobs` },
            { label: 'Usual day', value: `${median} h (median of ${days.length} working days)` },
          ],
          suggestedAction: 'message_worker',
        });
      }
    }
  }

  return found;
}

/** Merges fresh detections into the stored list without duplicating or reopening cards. */
export function mergeAnomalies(existing: Anomaly[], found: Found[], now: Date = new Date()): Anomaly[] {
  const known = new Map(existing.map((a) => [a.id, a]));
  const merged = found.map((f) => {
    const prior = known.get(f.id);
    return prior ? { ...prior, ...f, status: prior.status, detectedAt: prior.detectedAt } : { ...f, status: 'open' as const, detectedAt: now.toISOString() };
  });
  // Cards already acted on stay in the feed even when the condition has cleared (a cancelled item, say).
  const foundIds = new Set(found.map((f) => f.id));
  const kept = existing.filter((a) => !foundIds.has(a.id) && a.status !== 'open');
  const rank = { high: 0, medium: 1, low: 2 };
  return [...merged, ...kept].sort((a, b) => rank[a.severity] - rank[b.severity] || b.amountAtRisk - a.amountAtRisk);
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
