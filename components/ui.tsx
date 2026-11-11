// Small shared UI pieces.

import type { ComponentProps, ReactNode } from 'react';

const cx = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' ');

/** The tag on every AI-produced output, naming the model that produced it. */
export function AiTag({ model, className }: { model: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full border border-pd-teal/40 bg-pd-highlight px-2 py-0.5 text-[11px] font-semibold text-pd-teal-dark', className)}
      title={`Produced by the model ${model}`}
      data-testid="ai-tag"
    >
      <span aria-hidden="true" className="rounded bg-pd-teal px-1 text-[10px] leading-4 text-white">AI</span>
      <span className="sr-only">AI output from </span>
      {model.split('/').pop()}
    </span>
  );
}

const TONES: Record<string, string> = {
  SUCCESS: 'bg-pd-success-bg text-pd-success',
  paid: 'bg-pd-success-bg text-pd-success',
  verified: 'bg-pd-success-bg text-pd-success',
  actioned: 'bg-pd-success-bg text-pd-success',
  PENDING: 'bg-pd-amber-bg text-pd-amber',
  submitted: 'bg-pd-amber-bg text-pd-amber',
  needs_review: 'bg-pd-amber-bg text-pd-amber',
  UNCLAIMED: 'bg-pd-amber-bg text-pd-amber',
  medium: 'bg-pd-amber-bg text-pd-amber',
  open: 'bg-pd-amber-bg text-pd-amber',
  FAILED: 'bg-pd-danger-bg text-pd-danger',
  rejected: 'bg-pd-danger-bg text-pd-danger',
  high: 'bg-pd-danger-bg text-pd-danger',
  RETURNED: 'bg-slate-200 text-slate-700',
  CANCELED: 'bg-slate-200 text-slate-700',
  dismissed: 'bg-slate-200 text-slate-700',
  scheduled: 'bg-slate-200 text-slate-700',
  low: 'bg-slate-200 text-slate-700',
};

export function Chip({ value, label, className }: { value: string; label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONES[value] ?? 'bg-slate-200 text-slate-700', className)}>
      {label ?? value.replace(/_/g, ' ')}
    </span>
  );
}

export function SourceTag({ source }: { source: 'imported' | 'live' }) {
  return (
    <span className={cx('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', source === 'live' ? 'bg-pd-mint text-pd-teal-dark' : 'bg-pd-sand text-pd-muted')}>
      {source === 'live' ? 'Live sandbox' : 'Imported history'}
    </span>
  );
}

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean; small?: boolean };

export function Button({ variant = 'primary', busy, small, className, children, disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: 'bg-pd-teal text-white hover:bg-pd-teal-dark',
    secondary: 'border border-pd-border bg-white text-pd-ink hover:bg-pd-highlight',
    danger: 'bg-pd-danger text-white hover:opacity-90',
    ghost: 'text-pd-teal-dark hover:bg-pd-highlight',
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        small ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-[15px]',
        styles,
        className,
      )}
    >
      {busy && <span aria-hidden="true" className="pd-pulse inline-block h-2 w-2 rounded-full bg-current" />}
      {children}
    </button>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-xl border border-pd-border bg-white', className)}>
      {children}
    </div>
  );
}

export { cx };
