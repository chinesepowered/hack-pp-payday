// The built-in report: three pages (layout presets) as AG Studio report state. Field ids refer to
// the data sources in ./data.ts; 'anomaly-feed', 'time-to-pay' and 'worker-earnings' are the
// custom widgets in ./widgets.tsx.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

export const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
export const title = (text: string) => ({ title: { enabled: true, text } });
export const sum = (id: string) => ({ id, aggregation: 'sum' as const });

const FONT = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: 'normal' as const });

const kpi = (text: string, fieldId: string) => ({
  type: 'value' as const,
  dataMapping: { value: [sum(fieldId)] },
  format: {
    title: { enabled: true, text, typography: typography(13, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(24, 'bold') },
  },
});

const legend = { style: { theme: { common: { legend: { enabled: true, position: 'bottom' } } } } };

export const WIDGETS = {
  payoutsByDay: {
    type: 'column-chart-stacked',
    dataMapping: { categoryKey: [{ id: 'payouts.date' }], valueKey: [sum('payouts.regularAmount'), sum('payouts.duplicateAmount')] },
    sort: [{ field: { id: 'payouts.date' }, direction: 'asc' }],
    format: { ...title('Payouts by day: regular and duplicate'), ...legend },
  },
  cashflow: {
    type: 'column-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'cashflow.date' }], valueKey: [sum('cashflow.moneyIn'), sum('cashflow.moneyOut')] },
    sort: [{ field: { id: 'cashflow.date' }, direction: 'asc' }],
    format: { ...title('Money in from customers, money out to workers'), ...legend },
  },
  byWorker: {
    type: 'bar-chart-stacked',
    dataMapping: { categoryKey: [{ id: 'payouts.worker' }], valueKey: [sum('payouts.regularAmount'), sum('payouts.duplicateAmount')] },
    format: { ...title('Payouts by worker'), ...legend },
  },
  fees: {
    type: 'column-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'cashflow.date' }], valueKey: [sum('cashflow.payoutFees'), sum('cashflow.orderFees')] },
    sort: [{ field: { id: 'cashflow.date' }, direction: 'asc' }],
    format: { ...title('PayPal fees by day: payouts and orders'), ...legend },
  },
  duplicatesByDay: {
    type: 'column-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'duplicates.weekday' }, { id: 'duplicates.date' }], valueKey: [sum('duplicates.amount')] },
    sort: [{ field: { id: 'duplicates.date' }, direction: 'asc' }],
    format: title('Proof: duplicate payouts by day'),
  },
  duplicatesGrid: {
    type: 'grid',
    dataMapping: {
      cols: [{ id: 'duplicates.jobId' }, { id: 'duplicates.worker' }, { id: 'duplicates.firstPaidAt' }, { id: 'duplicates.paidAgainAt' }, { id: 'duplicates.channel' }, { id: 'duplicates.source' }, sum('duplicates.amount')],
    },
    format: title('Proof: jobs that were paid twice'),
  },
  unclaimedGrid: {
    type: 'grid',
    dataMapping: { cols: [{ id: 'unclaimed.jobId' }, { id: 'unclaimed.worker' }, { id: 'unclaimed.sentTo' }, { id: 'unclaimed.sentAt' }, { id: 'unclaimed.paypalItemId' }, sum('unclaimed.ageHours'), sum('unclaimed.amount')] },
    format: title('Unclaimed payouts'),
  },
  overpaidGrid: {
    type: 'grid',
    dataMapping: { cols: [{ id: 'payouts.jobId' }, { id: 'payouts.worker' }, { id: 'payouts.flags' }, { id: 'payouts.paidAt' }, sum('jobs.amount'), sum('payouts.amount')] },
    sort: [{ field: sum('payouts.amount'), direction: 'desc' }],
    format: title('Largest payouts against the job amount'),
  },
  anomalyKinds: {
    type: 'donut-chart',
    dataMapping: { categoryKey: [{ id: 'anomalies.kind' }], valueKey: [sum('anomalies.amountAtRisk')] },
    format: title('Money at risk by anomaly kind'),
  },
  anomalyFeed: { type: 'anomaly-feed', format: title('Anomaly feed') },
  unclaimedActions: { type: 'unclaimed-actions', format: title('Suggested actions: unclaimed payouts') },
  timeToPay: { type: 'time-to-pay', format: title('Time to pay: job done to money received') },
  workerEarnings: { type: 'worker-earnings', format: title('Worker earnings') },
  ledger: {
    type: 'grid',
    dataMapping: {
      cols: [{ id: 'payouts.paidAt' }, { id: 'payouts.worker' }, { id: 'payouts.jobId' }, { id: 'payouts.status' }, { id: 'payouts.channel' }, { id: 'payouts.source' }, { id: 'payouts.flags' }, sum('payouts.fee'), sum('payouts.amount')],
    },
    sort: [{ field: { id: 'payouts.paidAt' }, direction: 'desc' }],
    format: title('Payout ledger'),
  },
  workerPivot: {
    type: 'pivot-grid',
    dataMapping: { rows: [{ id: 'payouts.worker' }], columns: [{ id: 'payouts.channel' }], values: [sum('payouts.amount')] },
    format: title('Paid by worker and channel'),
  },
  hoursByWorker: {
    type: 'bar-chart-grouped',
    dataMapping: { categoryKey: [{ id: 'workers.name' }], valueKey: [sum('workers.hours')] },
    format: title('Hours worked, last two weeks'),
  },
} as const;

const overview = {
  id: 'overview',
  widgets: {
    'kpi-paid': kpi('Paid today', 'summary.paidToday'),
    'kpi-median': kpi('Median minutes to pay', 'summary.medianMinutesToPay'),
    'kpi-unclaimed': kpi('Unclaimed money', 'summary.unclaimed'),
    'kpi-risk': kpi('At risk in open anomalies', 'summary.atRisk'),
    'kpi-fees': kpi('Payout fees today', 'summary.feesToday'),
    'payouts-by-day': WIDGETS.payoutsByDay,
    'anomaly-feed': WIDGETS.anomalyFeed,
    cashflow: WIDGETS.cashflow,
    'time-to-pay': WIDGETS.timeToPay,
    'by-worker': WIDGETS.byWorker,
    fees: WIDGETS.fees,
  },
  widgetLayout: {
    'kpi-paid': at(0, 0, 5, 6),
    'kpi-median': at(5, 0, 5, 6),
    'kpi-unclaimed': at(10, 0, 5, 6),
    'kpi-risk': at(15, 0, 5, 6),
    'kpi-fees': at(20, 0, 4, 6),
    'payouts-by-day': at(0, 6, 15, 19),
    'anomaly-feed': at(15, 6, 9, 38),
    cashflow: at(0, 25, 8, 19),
    'time-to-pay': at(8, 25, 7, 19),
    'by-worker': at(0, 44, 12, 18),
    fees: at(12, 44, 12, 18),
  },
};

const risk = {
  id: 'risk',
  widgets: {
    'kpi-risk': kpi('At risk in open anomalies', 'summary.atRisk'),
    'kpi-open': kpi('Open anomalies', 'summary.openAnomalies'),
    'kpi-unclaimed': kpi('Unclaimed money', 'summary.unclaimed'),
    'anomaly-feed': WIDGETS.anomalyFeed,
    'anomaly-kinds': WIDGETS.anomalyKinds,
    duplicates: WIDGETS.duplicatesGrid,
    unclaimed: WIDGETS.unclaimedGrid,
  },
  widgetLayout: {
    'kpi-risk': at(0, 0, 5, 6),
    'kpi-open': at(5, 0, 5, 6),
    'kpi-unclaimed': at(10, 0, 5, 6),
    'anomaly-kinds': at(0, 6, 15, 16),
    'anomaly-feed': at(15, 0, 9, 50),
    duplicates: at(0, 22, 15, 15),
    unclaimed: at(0, 37, 15, 13),
  },
};

const workers = {
  id: 'workers',
  widgets: {
    'worker-earnings': WIDGETS.workerEarnings,
    'time-to-pay': WIDGETS.timeToPay,
    'worker-pivot': WIDGETS.workerPivot,
    hours: WIDGETS.hoursByWorker,
    ledger: WIDGETS.ledger,
  },
  widgetLayout: {
    'worker-earnings': at(0, 0, 14, 22),
    'time-to-pay': at(14, 0, 10, 22),
    'worker-pivot': at(0, 22, 12, 14),
    hours: at(12, 22, 12, 14),
    ledger: at(0, 36, 24, 22),
  },
};

export const PAGES = [
  { id: 'overview', title: 'Overview' },
  { id: 'risk', title: 'Risk review' },
  { id: 'workers', title: 'Workers' },
];

export const defaultReport = {
  selectedPageId: 'overview',
  panels: { filters: { collapsed: true }, ai: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
  pages: [overview, risk, workers] as unknown as AgPageState[],
} as AgReportState;
