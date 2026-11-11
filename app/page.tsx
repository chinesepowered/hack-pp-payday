import Link from 'next/link';
import { Rio } from '@/components/rio';

const STEPS = [
  { n: '1', title: 'Job complete', text: 'A worker submits the checklist and photos. AI checks the photos against the checklist, and code checks check-in time and location.' },
  { n: '2', title: 'Pay now', text: 'A verified job is paid at once through PayPal Payouts. The worker sees the money seconds later.' },
  { n: '3', title: 'Watchdog', text: 'Rules and AI watch every payout for duplicates, overpayments, changed emails and unclaimed money. You approve the fix.' },
];

const DOORS = [
  { href: '/worker', title: 'Worker app', text: 'Finish a job as Maya and get paid in the sandbox.', cta: 'Open the worker app', testId: 'door-worker' },
  { href: '/ops', title: 'Payouts desk', text: 'Review flagged jobs, act on anomalies, reconcile with PayPal.', cta: 'Open the payouts desk', testId: 'door-ops' },
  { href: '/dashboard', title: 'Dashboard', text: 'The live AG Studio dashboard, with the Payout auditor agent.', cta: 'Open the dashboard', testId: 'door-dashboard' },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-16 pt-8">
      <section className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-pd-teal-dark">Payday, the payouts desk for small service marketplaces</p>
          <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Paid the day the job is done. Mistakes caught before they cost money.
          </h1>
          <p className="mt-4 max-w-[60ch] text-lg text-pd-muted">
            Gig workers on small marketplaces often wait days for pay, and platforms that pay by hand send duplicates, typo emails and unclaimed money.
            Payday pays each job the moment it is verified, through PayPal Payouts, and an AI auditor watches every payout.
          </p>
          <p className="mt-3 text-sm text-pd-muted">
            This demo runs TidyNest, a fictional home cleaning marketplace, against the PayPal sandbox. No real money moves.
          </p>
        </div>
        <Rio pose="wave" size={220} className="mx-auto" />
      </section>

      <section aria-label="Where to start" className="mt-8 grid gap-4 md:grid-cols-3">
        {DOORS.map((d) => (
          <Link key={d.href} href={d.href} data-testid={d.testId} className="group rounded-xl border border-pd-border bg-white p-5 transition hover:border-pd-teal hover:shadow-md">
            <h2 className="text-xl font-bold">{d.title}</h2>
            <p className="mt-1 text-sm text-pd-muted">{d.text}</p>
            <p className="mt-4 font-semibold text-pd-teal-dark group-hover:underline">{d.cta}</p>
          </Link>
        ))}
      </section>

      <section aria-labelledby="how" className="mt-10">
        <h2 id="how" className="text-2xl font-extrabold">How it works</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl bg-pd-sand p-5">
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-pd-teal font-bold text-white">{s.n}</span>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-pd-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-pd-muted">
          Tip: open <strong>Under the hood</strong> in the top bar at any time to see every PayPal call this session made, with its PayPal-Debug-Id. If the
          sandbox or the model is down, switch to <strong>Replay</strong> to run the flow from recorded responses.
        </p>
      </section>
    </div>
  );
}
