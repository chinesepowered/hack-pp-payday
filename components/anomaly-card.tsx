'use client';

// One watchdog finding: the evidence, the AI's explanation, and the suggested action, which only
// runs when the operator approves it. Used on the payouts desk and inside the AG Studio widget.

import { useState } from 'react';
import { api, money, timeOf } from '@/lib/client';
import type { ActionKind, Anomaly } from '@/lib/types';
import { Rio } from './rio';
import { AiTag, Button, Chip, cx } from './ui';

export const ACTION_LABEL: Record<ActionKind, string> = {
  hold_next_payout: 'Hold next payout',
  cancel_unclaimed_item: 'Cancel unclaimed item',
  message_worker: 'Message the worker',
};

const ACTION_HINT: Record<ActionKind, string> = {
  hold_next_payout: 'Stops automatic payouts to this worker until you release the hold.',
  cancel_unclaimed_item: 'Calls PayPal: POST /v1/payments/payouts-item/{id}/cancel. The money returns to the balance.',
  message_worker: 'Sends the drafted message to the worker app.',
};

export function AnomalyCard({ anomaly, worker, onChanged, compact }: { anomaly: Anomaly; worker?: string; onChanged?: () => void | Promise<void>; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = (Object.keys(ACTION_LABEL) as ActionKind[]).filter((a) => a !== anomaly.suggestedAction && (a !== 'cancel_unclaimed_item' || anomaly.kind === 'unclaimed_aging'));

  const act = async (action: ActionKind | 'dismiss') => {
    setBusy(action);
    setError(null);
    try {
      await api('/api/anomalies/action', { body: { id: anomaly.id, action } });
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
      await onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className={cx('rounded-xl border bg-white', anomaly.status === 'open' ? (anomaly.severity === 'high' ? 'border-pd-danger/50' : 'border-pd-border') : 'border-pd-border opacity-90')}
      aria-labelledby={`a-${anomaly.id}`}
      data-testid="anomaly-card"
      data-kind={anomaly.kind}
      data-status={anomaly.status}
    >
      <div className={cx('flex flex-wrap items-start gap-2', compact ? 'p-3' : 'p-4')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip value={anomaly.severity} label={`${anomaly.severity} risk`} />
            <span className="text-xs font-semibold uppercase tracking-wide text-pd-muted">{anomaly.kind.replace(/_/g, ' ')}</span>
          </div>
          <h3 id={`a-${anomaly.id}`} className="mt-1 text-base font-bold">{anomaly.title}</h3>
          <p className="text-xs text-pd-muted">{worker ? `${worker}, ` : ''}detected {timeOf(anomaly.detectedAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-pd-muted">At risk</p>
          <p className="text-lg font-extrabold">{money(anomaly.amountAtRisk)}</p>
        </div>
      </div>

      <div className={cx('space-y-3', compact ? 'px-3 pb-3' : 'px-4 pb-4')}>
        {anomaly.ai && (
          <p className="rounded-lg bg-pd-highlight p-3 text-sm">
            {anomaly.ai.summary} <AiTag model={anomaly.ai.model} className="ml-1 align-middle" />
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {anomaly.evidence.map((e) => (
            <div key={e.label} className="contents">
              <dt className="font-semibold text-pd-muted">{e.label}</dt>
              <dd className="break-words">{e.value}</dd>
            </div>
          ))}
        </dl>

        {anomaly.status === 'open' ? (
          <div className="border-t border-pd-border pt-3">
            <p className="text-xs text-pd-muted">
              Suggested: <strong className="text-pd-ink">{ACTION_LABEL[anomaly.suggestedAction]}</strong>. {ACTION_HINT[anomaly.suggestedAction]}
            </p>
            {anomaly.suggestedAction === 'message_worker' && anomaly.ai?.message && (
              <blockquote className="mt-2 rounded-lg border-l-4 border-pd-teal bg-pd-sand p-2 text-sm">
                {anomaly.ai.message} <AiTag model={anomaly.ai.model} className="ml-1 align-middle" />
              </blockquote>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button small busy={busy === anomaly.suggestedAction} disabled={busy !== null} onClick={() => void act(anomaly.suggestedAction)} data-testid={`approve-${anomaly.kind}`}>
                Approve: {ACTION_LABEL[anomaly.suggestedAction]}
              </Button>
              {others.map((a) => (
                <Button key={a} small variant="secondary" busy={busy === a} disabled={busy !== null} onClick={() => void act(a)}>
                  {ACTION_LABEL[a]}
                </Button>
              ))}
              <Button small variant="ghost" busy={busy === 'dismiss'} disabled={busy !== null} onClick={() => void act('dismiss')}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-pd-success-bg p-2 text-sm text-pd-ink" role="status" data-testid="anomaly-resolution">
            <Rio pose="paid" size={40} title="" />
            <span>
              <strong>{anomaly.status === 'dismissed' ? 'Dismissed' : 'Done'}.</strong> {anomaly.resolution?.detail}
            </span>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-pd-danger-bg p-2 text-sm text-pd-danger">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
