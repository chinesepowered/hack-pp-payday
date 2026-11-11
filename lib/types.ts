// Domain types for Payday, the payouts desk of the fictional marketplace TidyNest.

export type Room = 'kitchen' | 'bathroom' | 'bedroom' | 'living room' | 'hallway';

export type Worker = {
  id: string;
  name: string;
  email: string; // PayPal payout email
  previousEmail?: string;
  emailChangedAt?: string;
  area: string;
  hourlyRate: number;
  onHold?: boolean;
  holdReason?: string;
};

export type JobStatus = 'scheduled' | 'submitted' | 'verified' | 'needs_review' | 'paid' | 'rejected';
export type Source = 'imported' | 'live';

export type Check = { id: string; label: string; pass: boolean; detail: string; by: 'ai' | 'rule' };

export type Verification = {
  verdict: 'verified' | 'needs_review';
  reasons: string[];
  checks: Check[];
  model: string;
  at: string;
  trail: TrailStep[];
};

export type TrailStep = { at: string; step: string; detail: string; model?: string };

export type Job = {
  id: string;
  workerId: string;
  customer: string;
  address: string;
  lat: number;
  lng: number;
  type: 'Standard clean' | 'Deep clean' | 'Move-out clean';
  checklist: Room[];
  scheduledStart: string;
  scheduledEnd: string;
  checkInAt?: string;
  checkInLat?: number;
  checkInLng?: number;
  completedAt?: string;
  hours: number;
  amount: number; // what the worker earns for this job, USD
  customerPrice: number; // what the customer pays TidyNest, USD
  photos: string[]; // public paths of the evidence photos attached to the visit
  status: JobStatus;
  verification?: Verification;
  source: Source;
  orderId?: string;
  demoClock?: boolean; // check-in and completion were stamped by the demo at submit time
};

export type PayoutStatus =
  | 'PENDING' | 'SUCCESS' | 'UNCLAIMED' | 'FAILED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED' | 'REFUNDED' | 'REVERSED' | 'CANCELED';

export type Payout = {
  id: string; // local id; also the sender_item_id sent to PayPal
  jobId: string;
  workerId: string;
  email: string;
  amount: number;
  fee: number;
  status: PayoutStatus;
  source: Source;
  batchId?: string; // PayPal payout_batch_id (live only)
  itemId?: string; // PayPal payout_item_id (live only)
  transactionId?: string;
  channel: 'payday' | 'manual batch'; // manual batch is the operator's old process, where the mistakes come from
  createdAt: string;
  completedAt?: string;
  secondsToPay?: number; // job completed to payout success
  note?: string;
};

export type AnomalyKind =
  | 'duplicate_payout' | 'overpayment' | 'email_change' | 'double_booking' | 'unclaimed_aging' | 'hours_spike';

export type ActionKind = 'hold_next_payout' | 'cancel_unclaimed_item' | 'message_worker';

export type Anomaly = {
  id: string; // deterministic, so re-running detection never duplicates a card
  kind: AnomalyKind;
  severity: 'high' | 'medium' | 'low';
  title: string;
  workerId: string;
  payoutIds: string[];
  jobIds: string[];
  amountAtRisk: number;
  evidence: { label: string; value: string }[];
  suggestedAction: ActionKind;
  detectedAt: string;
  status: 'open' | 'actioned' | 'dismissed';
  resolution?: { action: ActionKind | 'dismiss'; at: string; detail: string };
  ai?: { summary: string; message?: string; model: string };
};

export type Order = {
  id: string; // PayPal order id for live, local id for imported
  jobId: string;
  amount: number;
  fee: number;
  status: string;
  source: Source;
  capturedAt: string;
};

export type Message = { id: string; workerId: string; at: string; text: string; anomalyId?: string };

export type AppState = {
  version: number;
  seededAt: string;
  workers: Worker[];
  jobs: Job[];
  payouts: Payout[];
  orders: Order[];
  anomalies: Anomaly[];
  messages: Message[];
  webhookEvents: string[]; // processed PayPal webhook event ids (idempotency)
};

export type PayPalCall = {
  at: string;
  method: string;
  path: string;
  status: number;
  debugId: string;
  feature: string;
  ms: number;
  replay?: boolean;
  via?: string; // 'REST' | 'Server SDK' | 'Agent Toolkit'
};
