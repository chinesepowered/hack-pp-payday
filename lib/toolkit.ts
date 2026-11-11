// PayPal Agent Toolkit (@paypal/agent-toolkit): the auditor's read-only PayPal tools.
// Only list_transactions and get_merchant_insights are enabled. Neither moves money. The tools
// that do move money (payouts, cancelling an item) are this app's own and sit behind lib/rules.ts.

import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { ctx, logCall } from './context';
import { readFixture, recordFixture, recording } from './fixtures';

let toolkit: PayPalAgentToolkit | null = null;
function kit() {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    configuration: { actions: { transactions: { list: true }, insights: { get: true } }, context: { sandbox: true } },
  });
  return toolkit;
}

const PATHS: Record<string, string> = { list_transactions: '/v1/reporting/transactions', get_merchant_insights: '/v2/merchant/insights (Agent Toolkit)' };

export async function toolkitCall(name: 'list_transactions' | 'get_merchant_insights', args: Record<string, unknown>): Promise<unknown> {
  const key = `toolkit:${name}`;
  const started = Date.now();
  if (ctx().mode === 'replay') {
    const hit = readFixture<unknown>('paypal', key);
    logCall({ method: 'GET', path: PATHS[name], status: 200, debugId: 'recorded', ms: 200, via: 'Agent Toolkit' });
    return hit ?? { note: 'No recording for this tool in Replay.' };
  }
  const reply = await kit().handleToolCall({ id: `call_${started}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const text = typeof reply.content === 'string' ? reply.content : JSON.stringify(reply.content);
  logCall({ method: 'GET', path: PATHS[name], status: 200, debugId: '', ms: Date.now() - started, via: 'Agent Toolkit' });
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (recording()) await recordFixture('paypal', key, parsed);
  return parsed;
}
