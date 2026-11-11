// AG Studio's data sources for the payouts dashboard: flat tables built from the app state
// (lib/view.ts), the relationships between them, and a one-row summary for the headline tiles.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import { round2 } from '@/lib/rules';
import { buildTables, headline, type PublicState } from '@/lib/view';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return { id, source: { tableId: sourceTable, fieldId: sourceField }, target: { tableId: targetTable, fieldId: targetField }, type: 'many-to-one' };
};

export function buildStudioData(state: PublicState): AgDataSourcesDefinition {
  const t = buildTables(state);
  const k = headline(state);
  const firstPaid = new Map<string, string>();
  for (const p of [...t.payouts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (!firstPaid.has(p.jobId)) firstPaid.set(p.jobId, p.createdAt.slice(0, 16).replace('T', ' '));

  const payouts = t.payouts.map((p) => ({ ...p, regularAmount: round2(p.amount - p.duplicateAmount), paidAt: p.createdAt.slice(0, 16).replace('T', ' ') }));
  const duplicates = payouts
    .filter((p) => p.duplicate)
    .map((p) => ({ id: p.id, jobId: p.jobId, worker: p.worker, amount: p.amount, firstPaidAt: firstPaid.get(p.jobId) ?? '', paidAgainAt: p.paidAt, date: p.date, weekday: p.weekday, channel: p.channel, source: p.source, paypalItemId: p.paypalItemId }));
  const unclaimed = payouts
    .filter((p) => p.status === 'UNCLAIMED')
    .map((p) => ({ id: p.id, jobId: p.jobId, worker: p.worker, sentTo: p.email, amount: p.amount, sentAt: p.paidAt, ageHours: round2((Date.now() - Date.parse(p.createdAt)) / 3_600_000), paypalItemId: p.paypalItemId, source: p.source }));
  const summary = [
    {
      id: 'now',
      paidToday: k.paidToday,
      payoutsToday: k.payoutsToday,
      medianMinutesToPay: k.medianMinutesPayday,
      medianDaysManual: k.medianDaysManual,
      unclaimed: k.unclaimed,
      openAnomalies: k.openAnomalies,
      atRisk: k.atRisk,
      feesToday: k.feesToday,
    },
  ];

  return {
    description:
      'Payouts desk of TidyNest, a fictional home cleaning marketplace that pays its cleaners through PayPal Payouts (sandbox). ' +
      'All money is USD. Rows marked "Imported history" are seeded records from the last two weeks; rows marked "Live sandbox" are real PayPal sandbox payouts. ' +
      'A payout with duplicate = true is a second payout for a job that was already paid.',
    sources: [
      {
        id: 'payouts',
        description: 'One row per payout to a worker. duplicateAmount is the amount when the payout is a duplicate, otherwise 0; regularAmount is the rest. minutesToPay is job completion to payout success.',
        data: payouts,
        fields: fields([
          ['id', 'Payout ID', 'textFormat', true],
          ['jobId', 'Job', 'textFormat'],
          ['workerId', 'Worker ID', 'textFormat', true],
          ['worker', 'Worker', 'textFormat'],
          ['email', 'Payout Email', 'textFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['regularAmount', 'Regular Amount', 'currencyFormat'],
          ['duplicateAmount', 'Duplicate Amount', 'currencyFormat'],
          ['unclaimedAmount', 'Unclaimed Amount', 'currencyFormat'],
          ['fee', 'Payout Fee', 'currencyFormat'],
          ['status', 'Status', 'textFormat'],
          ['channel', 'Channel', 'textFormat'],
          ['source', 'Source', 'textFormat'],
          ['date', 'Payout Date', 'dateFormat'],
          ['weekday', 'Weekday', 'textFormat'],
          ['paidAt', 'Paid At', 'textFormat'],
          ['minutesToPay', 'Minutes to Pay', 'decimalFormat'],
          ['duplicate', 'Duplicate', 'booleanFormat'],
          ['flags', 'Watchdog Flags', 'textFormat'],
          ['paypalItemId', 'PayPal Item ID', 'textFormat'],
          ['paypalBatchId', 'PayPal Batch ID', 'textFormat'],
        ]),
      },
      {
        id: 'jobs',
        description: 'One row per cleaning job. amount is what the worker earns; customerPrice is what the customer pays TidyNest.',
        data: t.jobs,
        fields: fields([
          ['id', 'Job ID', 'textFormat'],
          ['workerId', 'Worker ID', 'textFormat', true],
          ['worker', 'Job Worker', 'textFormat', true],
          ['customer', 'Customer', 'textFormat'],
          ['address', 'Address', 'textFormat'],
          ['type', 'Job Type', 'textFormat'],
          ['hours', 'Hours', 'decimalFormat'],
          ['amount', 'Job Amount', 'currencyFormat'],
          ['customerPrice', 'Customer Price', 'currencyFormat'],
          ['status', 'Job Status', 'textFormat'],
          ['verdict', 'AI Verdict', 'textFormat'],
          ['source', 'Job Source', 'textFormat', true],
          ['date', 'Job Date', 'dateFormat'],
        ]),
      },
      {
        id: 'workers',
        description: 'One row per worker, with totals.',
        data: t.workers,
        fields: fields([
          ['id', 'Worker ID', 'textFormat', true],
          ['name', 'Worker Name', 'textFormat'],
          ['area', 'Area', 'textFormat'],
          ['hourlyRate', 'Hourly Rate', 'currencyFormat'],
          ['earned', 'Earned', 'currencyFormat'],
          ['hours', 'Hours Worked', 'decimalFormat'],
          ['jobs', 'Jobs Paid', 'integerFormat'],
          ['medianMinutesToPay', 'Median Minutes to Pay', 'decimalFormat'],
          ['openFlags', 'Open Flags', 'integerFormat'],
          ['onHold', 'On Hold', 'booleanFormat'],
        ]),
      },
      {
        id: 'anomalies',
        description: 'Watchdog findings: duplicate payout, overpayment, email change, double booking, unclaimed aging, hours spike.',
        data: t.anomalies,
        fields: fields([
          ['id', 'Anomaly ID', 'textFormat', true],
          ['kind', 'Anomaly Kind', 'textFormat'],
          ['severity', 'Severity', 'textFormat'],
          ['title', 'Finding', 'textFormat'],
          ['worker', 'Flagged Worker', 'textFormat'],
          ['amountAtRisk', 'Amount at Risk', 'currencyFormat'],
          ['status', 'Anomaly Status', 'textFormat'],
          ['suggestedAction', 'Suggested Action', 'textFormat'],
          ['date', 'Detected', 'dateFormat'],
        ]),
      },
      {
        id: 'cashflow',
        description: 'One row per day: money in from customers (PayPal Orders), money out to workers (PayPal Payouts), and fees.',
        data: t.cashflow,
        fields: fields([
          ['date', 'Day', 'dateFormat'],
          ['weekday', 'Day of Week', 'textFormat'],
          ['moneyIn', 'Money In', 'currencyFormat'],
          ['moneyOut', 'Money Out', 'currencyFormat'],
          ['payoutFees', 'Payout Fees', 'currencyFormat'],
          ['orderFees', 'Order Fees', 'currencyFormat'],
          ['net', 'Net', 'currencyFormat'],
          ['payouts', 'Payout Count', 'integerFormat'],
        ]),
      },
      {
        id: 'duplicates',
        description: 'Only the duplicate payouts: the second (or later) payout for a job that was already paid.',
        data: duplicates,
        fields: fields([
          ['id', 'Duplicate Payout ID', 'textFormat', true],
          ['jobId', 'Duplicated Job', 'textFormat'],
          ['worker', 'Paid Twice To', 'textFormat'],
          ['amount', 'Paid Again', 'currencyFormat'],
          ['firstPaidAt', 'First Paid', 'textFormat'],
          ['paidAgainAt', 'Paid Again At', 'textFormat'],
          ['date', 'Duplicate Date', 'dateFormat'],
          ['weekday', 'Duplicate Weekday', 'textFormat'],
          ['channel', 'Duplicate Channel', 'textFormat'],
          ['source', 'Duplicate Source', 'textFormat'],
          ['paypalItemId', 'Duplicate PayPal Item', 'textFormat'],
        ]),
      },
      {
        id: 'unclaimed',
        description: 'Payouts PayPal reports as UNCLAIMED: the receiver email has no PayPal account. They can be cancelled.',
        data: unclaimed,
        fields: fields([
          ['id', 'Unclaimed Payout ID', 'textFormat', true],
          ['jobId', 'Unclaimed Job', 'textFormat'],
          ['worker', 'Owed To', 'textFormat'],
          ['sentTo', 'Sent To', 'textFormat'],
          ['amount', 'Unclaimed', 'currencyFormat'],
          ['sentAt', 'Sent At', 'textFormat'],
          ['ageHours', 'Age (hours)', 'decimalFormat'],
          ['paypalItemId', 'Unclaimed PayPal Item', 'textFormat'],
          ['source', 'Unclaimed Source', 'textFormat', true],
        ]),
      },
      {
        id: 'summary',
        description: 'One row of headline numbers as of now.',
        data: summary,
        fields: fields([
          ['id', 'Summary ID', 'textFormat', true],
          ['paidToday', 'Paid Today', 'currencyFormat'],
          ['payoutsToday', 'Payouts Today', 'integerFormat'],
          ['medianMinutesToPay', 'Median Minutes to Pay (Payday)', 'decimalFormat'],
          ['medianDaysManual', 'Median Days to Pay (Manual)', 'decimalFormat'],
          ['unclaimed', 'Unclaimed Money', 'currencyFormat'],
          ['openAnomalies', 'Open Anomalies', 'integerFormat'],
          ['atRisk', 'At Risk', 'currencyFormat'],
          ['feesToday', 'Payout Fees Today', 'currencyFormat'],
        ]),
      },
    ],
    relationships: [manyToOne('payout-worker', 'payouts.workerId', 'workers.id'), manyToOne('payout-job', 'payouts.jobId', 'jobs.id')],
  };
}
