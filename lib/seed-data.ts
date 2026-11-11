// The seeded demo state. Everything here is fictional and deterministic: about 40 jobs of
// "imported history" over the last two weeks (TidyNest's records from before and after it switched
// to Payday), four jobs paid through a real sandbox batch by `pnpm seed`, and today's schedule.

import type { AppState, Job, Order, Payout, Room, Worker } from './types';
import { round2 } from './rules';

export const TYPO_EMAIL_NOTE = 'A deliberately mistyped copy of a worker email, so the payout stays UNCLAIMED.';

export function workerEmails(): string[] {
  const list = (process.env.PAYPAL_SANDBOX_WORKER_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  return [list[0] ?? 'worker1@payday.example', list[1] ?? 'worker2@payday.example', list[2] ?? 'worker3@payday.example'];
}

/** worker3's email with two letters of the domain swapped: no PayPal account exists for it. */
export function typoEmail(): string {
  const [local, domain = 'payday.example'] = workerEmails()[2].split('@');
  const swapped = domain.length > 4 ? domain.slice(0, 2) + domain[3] + domain[2] + domain.slice(4) : `${domain}m`;
  return `${local}@${swapped}`;
}

export function seedWorkers(): Worker[] {
  const [e1, e2, e3] = workerEmails();
  return [
    { id: 'w1', name: 'Maya Okafor', email: e1, area: 'Mission District', hourlyRate: 34.4 },
    { id: 'w2', name: 'Dario Silva', email: e2, area: 'Sunset', hourlyRate: 32 },
    { id: 'w3', name: 'Priya Nair', email: e3, area: 'Noe Valley', hourlyRate: 26 },
    { id: 'w4', name: 'Tomas Reyes', email: 'tomas.reyes@tidynest-crew.example', area: 'Richmond', hourlyRate: 30 },
    { id: 'w5', name: 'Lena Fischer', email: 'lena.fischer@tidynest-crew.example', area: 'Bernal Heights', hourlyRate: 28 },
  ];
}

/** Workers with a real sandbox PayPal account, who can be paid live in the demo. */
export const LIVE_WORKER_IDS = ['w1', 'w2', 'w3'];

const PLACES: { customer: string; address: string; lat: number; lng: number }[] = [
  { customer: 'The Albrechts', address: '214 Juniper Lane', lat: 37.7599, lng: -122.4148 },
  { customer: 'S. Marchetti', address: '88 Calloway Street, Apt 3', lat: 37.7527, lng: -122.4313 },
  { customer: 'Kwame and Ines', address: '1502 Larkmoor Avenue', lat: 37.7544, lng: -122.4852 },
  { customer: 'R. Hallstrom', address: '37 Pepperwood Court', lat: 37.7791, lng: -122.4703 },
  { customer: 'The Duvalls', address: '640 Marigold Terrace', lat: 37.7412, lng: -122.4178 },
  { customer: 'J. Okonkwo', address: '9 Tidewater Mews', lat: 37.7686, lng: -122.4494 },
  { customer: 'Bea Lindqvist', address: '2231 Sorrel Street', lat: 37.7631, lng: -122.4027 },
  { customer: 'The Paredes family', address: '415 Quillfeather Road', lat: 37.7352, lng: -122.4411 },
];

const TYPES: { type: Job['type']; hours: number; checklist: Room[] }[] = [
  { type: 'Standard clean', hours: 2.5, checklist: ['kitchen', 'bathroom', 'living room'] },
  { type: 'Deep clean', hours: 4, checklist: ['kitchen', 'bathroom', 'bedroom', 'living room'] },
  { type: 'Move-out clean', hours: 5, checklist: ['kitchen', 'bathroom', 'bedroom', 'living room', 'hallway'] },
];

export const PHOTO: Record<Room, string[]> = {
  kitchen: ['/photos/kitchen-1.png', '/photos/kitchen-2.png'],
  bathroom: ['/photos/bathroom-1.png', '/photos/bathroom-2.png'],
  bedroom: ['/photos/bedroom-1.png', '/photos/bedroom-2.png'],
  'living room': ['/photos/living-1.png', '/photos/living-2.png'],
  hallway: ['/photos/hallway-1.png', '/photos/hallway-1.png'],
};

const photosFor = (rooms: Room[], variant: number) => rooms.map((r) => PHOTO[r][variant % 2]);

// Small deterministic generator, so the history is identical on every seed and reset.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAY = 86_400_000;
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

/** Midnight Pacific (UTC-8, the demo runs in November) of the day `daysAgo` days before `now`. */
function dayStart(now: Date, daysAgo: number) {
  const pt = new Date(now.getTime() - 8 * 3_600_000);
  return Date.UTC(pt.getUTCFullYear(), pt.getUTCMonth(), pt.getUTCDate()) + 8 * 3_600_000 - daysAgo * DAY;
}

function lastTuesday(now: Date) {
  for (let d = 1; d <= 7; d++) if (new Date(dayStart(now, d) + 12 * 3_600_000).getUTCDay() === 2) return d;
  return 1;
}

function makeJob(id: string, worker: Worker, place: (typeof PLACES)[number], kind: (typeof TYPES)[number], start: number, source: Job['source'], variant: number): Job {
  const amount = round2(worker.hourlyRate * kind.hours);
  return {
    id,
    workerId: worker.id,
    customer: place.customer,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    type: kind.type,
    checklist: kind.checklist,
    scheduledStart: iso(start),
    scheduledEnd: iso(start + kind.hours * 3_600_000),
    hours: kind.hours,
    amount,
    customerPrice: round2(Math.ceil((amount * 1.45) / 5) * 5),
    photos: photosFor(kind.checklist, variant),
    status: 'scheduled',
    source,
  };
}

const complete = (job: Job, startDelayMin: number, lat = job.lat + 0.0004, lng = job.lng - 0.0003): Job => ({
  ...job,
  checkInAt: iso(Date.parse(job.scheduledStart) + startDelayMin * MIN),
  checkInLat: lat,
  checkInLng: lng,
  completedAt: iso(Date.parse(job.scheduledEnd) + (startDelayMin - 4) * MIN),
});

const importedOrder = (job: Job): Order => ({
  id: `IMP-ORD-${job.id}`,
  jobId: job.id,
  amount: job.customerPrice,
  fee: round2(job.customerPrice * 0.0349 + 0.49),
  status: 'COMPLETED',
  source: 'imported',
  capturedAt: job.completedAt!,
});

export function buildSeedState(now: Date = new Date()): AppState {
  const rand = rng(20261111);
  const workers = seedWorkers();
  const jobs: Job[] = [];
  const payouts: Payout[] = [];
  const orders: Order[] = [];
  const slots = [9, 12.5, 15]; // local start hours
  const tuesday = lastTuesday(now);
  let n = 0;

  const pay = (job: Job, channel: Payout['channel'], createdAt: number, suffix = ''): Payout => {
    const done = createdAt + (channel === 'payday' ? 25_000 + Math.floor(rand() * 40_000) : 90_000);
    return {
      id: `IMP-${job.id}${suffix}`,
      jobId: job.id,
      workerId: job.workerId,
      email: workers.find((w) => w.id === job.workerId)!.email,
      amount: job.amount,
      fee: 0.25,
      status: 'SUCCESS',
      source: 'imported',
      channel,
      createdAt: iso(createdAt),
      completedAt: iso(done),
      secondsToPay: Math.round((done - Date.parse(job.completedAt!)) / 1000),
    };
  };

  for (let d = 14; d >= 1; d--) {
    const start = dayStart(now, d);
    const manual = d > 7; // the first week predates Payday: one manual batch every Friday-ish
    for (let s = 0; s < 3; s++) {
      n++;
      // Yesterday belongs to the two history-only workers, so imported jobs never overlap the live batch.
      const worker = d === 1 ? workers[3 + (s % 2)] : workers[(n + d) % workers.length];
      const place = PLACES[Math.floor(rand() * PLACES.length)];
      const kind = TYPES[rand() < 0.62 ? 0 : rand() < 0.75 ? 1 : 2];
      const job = { ...complete(makeJob(`J-${String(1000 + n)}`, worker, place, kind, start + slots[s] * 3_600_000, 'imported', n), Math.floor(rand() * 12) - 2), status: 'paid' as const };
      jobs.push(job);
      orders.push(importedOrder(job));
      // Manual era: paid in the next batch run, 1 to 4 days later. Payday era: minutes after the job.
      const createdAt = manual
        ? dayStart(now, Math.max(d - 1 - Math.floor(rand() * 3), 7)) + 16.2 * 3_600_000
        : Date.parse(job.completedAt!) + (2 + Math.floor(rand() * 7)) * MIN;
      payouts.push(pay(job, manual ? 'manual batch' : 'payday', createdAt));
    }
  }

  // Planted: last Tuesday the old CSV was uploaded a second time, paying three week-one jobs twice.
  const resent = jobs.filter((j) => Date.parse(j.completedAt!) < dayStart(now, 9)).slice(0, 3);
  resent.forEach((job, i) => payouts.push(pay(job, 'manual batch', dayStart(now, tuesday) + 16.2 * 3_600_000 + i * 1000, '-R')));

  // Planted: two jobs at the same time in different places (Tomas, six days ago).
  const w4 = workers[3];
  const a = { ...complete(makeJob('J-2001', w4, PLACES[2], TYPES[0], dayStart(now, 6) + 10 * 3_600_000, 'imported', 0), 3), status: 'paid' as const };
  const b = { ...complete(makeJob('J-2002', w4, PLACES[6], TYPES[0], dayStart(now, 6) + 11 * 3_600_000, 'imported', 1), 5), status: 'paid' as const };
  // Planted: a sudden spike in Lena's hours (four days ago).
  const w5 = workers[4];
  const spike = [6, 11.5, 17].map((h, i) => ({
    ...complete(makeJob(`J-210${i + 1}`, w5, PLACES[(i * 3 + 1) % PLACES.length], TYPES[i === 2 ? 1 : 2], dayStart(now, 4) + h * 3_600_000, 'imported', i), 2),
    status: 'paid' as const,
  }));
  for (const job of [a, b, ...spike]) {
    jobs.push(job);
    orders.push(importedOrder(job));
    payouts.push(pay(job, 'payday', Date.parse(job.completedAt!) + 4 * MIN));
  }

  // This morning's jobs, paid by the operator's last manual batch. `pnpm seed` sends that batch to
  // the PayPal sandbox for real; the payouts are attached from its record (see lib/seed-live.ts).
  const morning = dayStart(now, 0);
  const live = [
    complete(makeJob('J-3001', workers[0], PLACES[0], TYPES[0], morning - DAY + 13 * 3_600_000, 'live', 0), 4),
    complete(makeJob('J-3002', workers[1], PLACES[3], { ...TYPES[0], hours: 2 }, morning - DAY + 14 * 3_600_000, 'live', 1), 2),
    complete(makeJob('J-3003', workers[2], PLACES[4], { ...TYPES[1], hours: 3.5 }, morning - DAY + 9 * 3_600_000, 'live', 0), 6),
    complete(makeJob('J-3004', workers[1], PLACES[5], { ...TYPES[1], hours: 2.75 }, morning - DAY + 9.5 * 3_600_000, 'live', 1), 1),
  ].map((j) => ({ ...j, status: 'verified' as const }));
  jobs.push(...live);

  jobs.push(...todaysJobs(now));

  return { version: 1, seededAt: now.toISOString(), workers, jobs, payouts, orders, anomalies: [], messages: [], webhookEvents: [] };
}

/** Today's schedule: jobs the demo's workers can complete live. One has a photo set missing a required room. */
export function todaysJobs(now: Date, round = 0): Job[] {
  const workers = seedWorkers();
  const t = now.getTime();
  const tag = round ? `-${round}` : '';
  const mk = (id: string, w: Worker, place: number, kind: (typeof TYPES)[number], endsMinAgo: number, variant: number) =>
    makeJob(`${id}${tag}`, w, PLACES[place], kind, t - endsMinAgo * MIN - kind.hours * 3_600_000, 'live', variant);
  const missing = mk('J-4002', workers[0], 6, TYPES[1], -180, 1);
  return [
    mk('J-4001', workers[0], 1, TYPES[0], 4, 0),
    { ...missing, photos: missing.photos.filter((p) => !p.includes('bathroom')) }, // the planted incomplete photo set
    mk('J-4003', workers[2], 7, TYPES[1], 6, 1),
    mk('J-4004', workers[1], 2, TYPES[0], 5, 1),
  ];
}

/** What the operator's manual batch paid this morning, mistakes included. Sent for real by `pnpm seed`. */
export function manualBatchPlan() {
  const workers = seedWorkers();
  const amount = (id: string, hours: number) => round2(workers.find((w) => w.id === id)!.hourlyRate * hours);
  return [
    { key: 'a', jobId: 'J-3001', workerId: 'w1', email: workers[0].email, amount: amount('w1', 2.5), note: 'J-3001 Standard clean' },
    { key: 'b', jobId: 'J-3001', workerId: 'w1', email: workers[0].email, amount: amount('w1', 2.5), note: 'J-3001 Standard clean' }, // duplicate
    { key: 'c', jobId: 'J-3002', workerId: 'w2', email: workers[1].email, amount: amount('w2', 2) * 10, note: 'J-3002 Standard clean' }, // decimal slip: 10x
    { key: 'd', jobId: 'J-3003', workerId: 'w3', email: typoEmail(), amount: amount('w3', 3.5), note: 'J-3003 Deep clean' }, // mistyped email
    { key: 'e', jobId: 'J-3004', workerId: 'w2', email: workers[1].email, amount: amount('w2', 2.75), note: 'J-3004 Deep clean' }, // right after an email change
  ];
}
