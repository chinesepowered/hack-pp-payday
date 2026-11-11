// The Payout auditor: a custom agent in AG Studio's Agent Framework.
//
// It is the agent a new conversation starts with. It has its own tools (audit queries over the
// payout data, read-only PayPal lookups, and tools that pin evidence widgets onto the dashboard
// through the Studio API), plus Studio's own read tools, and it hands free-form dashboard building
// to Studio's built-in agents with delegate_to. Every agent runs on Studio's direct LLM loop
// against the same adapter, which posts to this app's /api/ai/responses proxy (W&B Inference).
//
// Guardrail: the auditor cannot move money. It can only propose; cancelling an unclaimed item or
// holding a payout happens when the operator presses the button on an anomaly card.

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgAiTool, type AgAiToolContext, type AgReportState, type AgStudioApi } from 'ag-studio';
import { isDead, round2 } from '@/lib/rules';
import { buildTables, ptDay, weekday } from '@/lib/view';
import { openaiAdapter } from './openai-adapter';
import { at, WIDGETS } from './report';
import type { DashStore } from './widgets';

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Why did payouts spike on Tuesday?', prompt: 'Why did payouts spike on Tuesday?' },
  { label: 'Unclaimed payouts', prompt: 'Show me unclaimed payouts and what I should do about them.' },
  { label: 'Biggest risk right now', prompt: 'What is the biggest payout risk right now, and what do you suggest?' },
  { label: 'Build a chart', prompt: 'Add a chart of payout amount by worker and channel.' },
];

type Evidence = 'duplicates' | 'unclaimed' | 'overpayments' | 'time_to_pay';

/** What each evidence request pins onto the current page. */
const EVIDENCE: Record<Evidence, { id: string; widget: unknown; span: [number, number] }[]> = {
  duplicates: [
    { id: 'duplicates-by-day', widget: WIDGETS.duplicatesByDay, span: [10, 16] },
    { id: 'duplicates-proof', widget: WIDGETS.duplicatesGrid, span: [14, 16] },
  ],
  unclaimed: [
    { id: 'unclaimed-grid', widget: WIDGETS.unclaimedGrid, span: [14, 14] },
    { id: 'unclaimed-actions', widget: WIDGETS.unclaimedActions, span: [10, 24] },
  ],
  overpayments: [{ id: 'overpaid-grid', widget: WIDGETS.overpaidGrid, span: [24, 14] }],
  time_to_pay: [{ id: 'time-to-pay', widget: WIDGETS.timeToPay, span: [10, 20] }],
};

/** Adds evidence widgets at the top of the selected page through the Studio API, pushing the rest down. */
function pinEvidence(api: AgStudioApi, kind: Evidence): string[] {
  const state = api.getState();
  const stamp = Date.now().toString(36);
  const added: string[] = [];
  const pages = state.pages.map((page) => {
    if (page.id !== state.selectedPageId) return page;
    const widgets: Record<string, unknown> = { ...(page.widgets as unknown as Record<string, unknown>) };
    const layout: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> = { ...(page.widgetLayout as unknown as Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }>) };
    const items = EVIDENCE[kind].filter((e) => !Object.keys(widgets).some((id) => id.startsWith(`auditor-${e.id}`)));
    const height = Math.max(0, ...items.map((e) => e.span[1]));
    if (!items.length) return page;
    for (const id of Object.keys(layout)) layout[id] = { ...layout[id], yTrack: layout[id].yTrack + height };
    let x = 0;
    for (const e of items) {
      const id = `auditor-${e.id}-${stamp}`;
      widgets[id] = e.widget;
      layout[id] = at(x, 0, e.span[0], height);
      x += e.span[0];
      added.push(id);
    }
    return { ...page, widgets, widgetLayout: layout };
  });
  if (added.length) api.setState({ ...state, pages } as AgReportState);
  return added;
}

async function server(tool: string, args: unknown, ctx: AgAiToolContext) {
  const res = await fetch(`/api/auditor/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}), signal: ctx.signal });
  const json = await res.json().catch(() => ({ error: 'The server did not answer.' }));
  window.dispatchEvent(new Event('payday:calls'));
  if (!res.ok || json.error) return ctx.error(String(json.error?.message ?? json.error ?? `HTTP ${res.status}`));
  return ctx.success(JSON.stringify(json).slice(0, 6000));
}

function auditorTools(api: AgStudioApi, store: DashStore): AgAiTool[] {
  const tables = () => buildTables(store.get());
  return [
    api.defineAiTool({
      name: 'payout_totals_by_day',
      description: 'Total paid out per day for the last N days, with the weekday, the payout count and how much of each day was duplicate payouts. Use it first for any question about a spike or a trend.',
      params: (s) => s.object({ days: s.number({ description: 'How many days back, 1 to 21.' }) }),
      execute: (args: { days: number }, ctx) => {
        const from = ptDay(new Date(Date.now() - Math.min(21, Math.max(1, args.days || 14)) * 86_400_000).toISOString());
        const days = new Map<string, { date: string; weekday: string; total: number; payouts: number; duplicateTotal: number; duplicates: number }>();
        for (const p of tables().payouts) {
          if (p.date < from || ['CANCELED', 'RETURNED', 'FAILED'].includes(p.status)) continue;
          const d = days.get(p.date) ?? { date: p.date, weekday: p.weekday, total: 0, payouts: 0, duplicateTotal: 0, duplicates: 0 };
          d.total = round2(d.total + p.amount);
          d.payouts += 1;
          if (p.duplicate) {
            d.duplicateTotal = round2(d.duplicateTotal + p.amount);
            d.duplicates += 1;
          }
          days.set(p.date, d);
        }
        const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
        return ctx.success(JSON.stringify(rows), rows);
      },
    }),
    api.defineAiTool({
      name: 'find_duplicate_payouts',
      description: 'Lists every job that was paid more than once: the job, the worker, both payouts with their times, channel (manual batch or Payday) and PayPal item ids. Optionally narrowed to one day (YYYY-MM-DD).',
      params: (s) => s.object({ day: s.string({ description: 'YYYY-MM-DD to look at one day, or an empty string for all days.' }) }),
      execute: (args: { day: string }, ctx) => {
        const state = store.get();
        const groups = new Map<string, typeof state.payouts>();
        for (const p of state.payouts) if (!isDead(p)) groups.set(p.jobId, [...(groups.get(p.jobId) ?? []), p]);
        const rows = [...groups.entries()]
          .filter(([, list]) => list.length > 1)
          .map(([jobId, list]) => {
            const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            return {
              jobId,
              worker: state.workers.find((w) => w.id === sorted[0].workerId)?.name,
              jobAmount: state.jobs.find((j) => j.id === jobId)?.amount,
              payouts: sorted.map((p) => ({ id: p.id, amount: p.amount, day: ptDay(p.createdAt), weekday: weekday(ptDay(p.createdAt)), channel: p.channel, source: p.source, paypalItemId: p.itemId ?? null })),
              extraPaid: round2(sorted.slice(1).reduce((s, p) => s + p.amount, 0)),
            };
          })
          .filter((r) => !args.day || r.payouts.slice(1).some((p) => p.day === args.day));
        return ctx.success(JSON.stringify({ count: rows.length, extraPaidTotal: round2(rows.reduce((s, r) => s + r.extraPaid, 0)), rows }), rows);
      },
    }),
    api.defineAiTool({
      name: 'list_unclaimed_payouts',
      description: 'Lists payouts PayPal reports as UNCLAIMED, with the email they were sent to, the email on file for the worker, their age in hours and the PayPal item id. Optionally only those older than N days.',
      params: (s) => s.object({ olderThanDays: s.number({ description: 'Minimum age in days; 0 for all.' }) }),
      execute: (args: { olderThanDays: number }, ctx) => {
        const state = store.get();
        const rows = state.payouts
          .filter((p) => p.status === 'UNCLAIMED')
          .map((p) => ({
            payoutId: p.id,
            jobId: p.jobId,
            worker: state.workers.find((w) => w.id === p.workerId)?.name,
            sentTo: p.email,
            emailOnFile: state.workers.find((w) => w.id === p.workerId)?.email,
            amount: p.amount,
            ageHours: round2((Date.now() - Date.parse(p.createdAt)) / 3_600_000),
            paypalItemId: p.itemId ?? null,
            suggestedAction: 'cancel_unclaimed_item, then pay the job again to the email on file',
          }))
          .filter((r) => r.ageHours >= (args.olderThanDays || 0) * 24);
        return ctx.success(JSON.stringify({ count: rows.length, total: round2(rows.reduce((s, r) => s + r.amount, 0)), rows }), rows);
      },
    }),
    api.defineAiTool({
      name: 'list_anomalies',
      description: 'The watchdog findings (rules over every payout and job): kind, severity, worker, amount at risk, evidence, suggested action and status.',
      params: (s) => s.object({ status: s.enum(['open', 'all'] as const, { description: 'open for cards still waiting, all to include handled ones.' }) }),
      execute: (args: { status: 'open' | 'all' }, ctx) => {
        const state = store.get();
        const rows = state.anomalies
          .filter((a) => args.status === 'all' || a.status === 'open')
          .map((a) => ({ kind: a.kind, severity: a.severity, title: a.title, worker: state.workers.find((w) => w.id === a.workerId)?.name, amountAtRisk: a.amountAtRisk, evidence: a.evidence, suggestedAction: a.suggestedAction, status: a.status }));
        return ctx.success(JSON.stringify(rows), rows);
      },
    }),
    api.defineAiTool({
      name: 'show_evidence',
      description:
        'Builds evidence widgets on the current dashboard page through the Studio API. duplicates: a chart of duplicate payouts by day plus a grid of the jobs paid twice. ' +
        'unclaimed: a grid of unclaimed payouts plus cards with a cancel button for each. overpayments: a grid of the largest payouts against the job amount. time_to_pay: the time-to-pay distribution. ' +
        'Call it once you know what the evidence is, so the operator can see it.',
      params: (s) => s.object({ evidence: s.enum(['duplicates', 'unclaimed', 'overpayments', 'time_to_pay'] as const, { description: 'Which evidence to show.' }) }),
      execute: (args: { evidence: Evidence }, ctx) => {
        const added = pinEvidence(api, args.evidence);
        return ctx.success(added.length ? `Added ${added.length} widget(s) at the top of the page: ${added.join(', ')}.` : 'Those evidence widgets are already on the page.');
      },
    }),
    api.defineAiTool({
      name: 'paypal_item_status',
      description: 'Reads one payout item live from PayPal (GET /v1/payments/payouts-item/{id}) to confirm its current status. Works for live sandbox payouts only, not imported history.',
      params: (s) => s.object({ payoutId: s.string({ description: 'The payout id or the PayPal item id.' }) }),
      execute: (args: { payoutId: string }, ctx) => server('paypal_item_status', args, ctx),
    }),
    api.defineAiTool({
      name: 'list_transactions',
      description: 'PayPal Agent Toolkit list_transactions: the account ledger from PayPal Transaction Search for the last N days. It lags the ledger by up to 3 hours.',
      params: (s) => s.object({ days: s.number({ description: 'How many days back, 1 to 30.' }) }),
      execute: (args: { days: number }, ctx) => server('list_transactions', args, ctx),
    }),
    api.defineAiTool({
      name: 'get_merchant_insights',
      description: 'PayPal Agent Toolkit get_merchant_insights: daily sales insights for the last 14 days. May not be available in the sandbox.',
      params: (s) => s.object({ metric: s.enum(['SALES'] as const) }),
      execute: (args: { metric: 'SALES' }, ctx) => server('get_merchant_insights', args, ctx),
    }),
  ];
}

const INSTRUCTIONS = `You are the Payout auditor for TidyNest, a home cleaning marketplace that pays its cleaners through PayPal Payouts. You work inside the operator's AG Studio dashboard.

How you work:
1. Query before you answer. For a spike or trend, call payout_totals_by_day, then find_duplicate_payouts for the day that stands out. For unclaimed money, call list_unclaimed_payouts. For "what is wrong", call list_anomalies.
2. Show the proof. Once you know what explains it, call show_evidence so Studio builds the widgets on the page (duplicates, unclaimed, overpayments or time_to_pay).
3. Answer in three or four short sentences: what happened, the numbers (dates, amounts, how many payouts), and the action you suggest.
4. For any other dashboard request (a new chart, a filter, a layout change), hand it to Studio's own agents with delegate_to and report what they did.

Rules:
- Use only numbers from tool results. Never invent amounts, dates or ids.
- You cannot move money. You suggest; the operator approves on the anomaly card (hold next payout, cancel unclaimed item, message the worker).
- Rows marked imported are seeded history; rows marked live are real PayPal sandbox payouts.
- Plain words, no em dashes, no markdown tables.`;

export function buildAi(models: string[], store: DashStore): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: '/api/ai', model: models[0] });
  return ({ api }) =>
    createAiHarness(api, ({ tools, builtIn }) => {
      const own = auditorTools(api, store);
      const delegates = ['lead', 'data', 'page', 'widget'];
      return {
        agents: [
          directLlmRunner({
            id: 'payout-auditor',
            name: 'Payout auditor',
            description: 'Audits payouts: explains spikes, finds duplicates, overpayments and unclaimed money, and pins the evidence onto the dashboard.',
            adapter,
            maxTurns: 14,
            instructions: () => INSTRUCTIONS,
            tools: () => [...own, tools.studio.viewSchema(), tools.studio.viewPage(), tools.studio.executeQuery(), tools.delegateTo(delegates), tools.renameThread()],
          }),
          // Studio's own five agents, unchanged, on the same model: the auditor delegates to them.
          directLlmRunner({ ...builtIn.lead, adapter }),
          directLlmRunner({ ...builtIn.data, adapter }),
          directLlmRunner({ ...builtIn.page, adapter }),
          directLlmRunner({ ...builtIn.planning, adapter }),
          directLlmRunner({ ...builtIn.widget, adapter }),
        ],
        primary: 'payout-auditor',
        promptStarters: PROMPT_STARTERS,
        models: models.length > 1 ? models.map((id) => ({ id, label: id.split('/').pop() ?? id })) : undefined,
      };
    });
}
