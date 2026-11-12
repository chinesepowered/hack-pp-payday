# Hosted demo: how it was deployed

The hosted demo is https://hack-pp-payday.vercel.app. Everything runs against the PayPal sandbox.

## Steps

1. A Vercel project from this repository (Next.js, pnpm). No build settings changed.
2. A public Vercel Blob store connected to the project, which sets `BLOB_READ_WRITE_TOKEN`.
3. The variables from `.env.example` set on Vercel, except the sandbox buyer login, `ELEVENLABS_API_KEY` and
   `AG_STUDIO_LICENSE`. With no licence key the dashboard shows AG Studio's trial watermark.
4. `POST /api/admin/reset` with the `x-admin-token` header, which restores the seeded state in Blob and re-reads the
   seeded payouts from PayPal. The same call gives a clean demo at any time.
5. The webhook registered for `https://hack-pp-payday.vercel.app/api/paypal/webhook` with the payout batch and item
   events (`pnpm paypal:webhook <url>`), then `PAYPAL_WEBHOOK_ID` set on Vercel and a redeploy.

## Checked on the hosted demo

- The seeded state loads from Blob: 55 jobs, 55 payouts and 9 anomalies.
- The AG Studio dashboard renders with its custom widgets and layout presets.
- The Payout auditor answers "Why did payouts spike on Tuesday?": it calls its tools, finds the batch that was sent
  twice and pins the proof widget onto the page.

## Known gap

The worker payout does not start on the hosted demo yet. `POST /api/jobs/{id}/submit` verifies the job, and the
`POST /api/jobs/{id}/pay` call that follows answers `"Job is scheduled, not verified"`, with a job from an older
copy of the state. The Blob store path reads through the blob's public URL and saves the whole state on every
request, so one request can read or overwrite another's work. The flow works when run locally with the file store.

## Cancelling an unclaimed payout in the sandbox

On Wed Nov 11 2026 every call to `POST /v1/payments/payouts-item/{id}/cancel` for an UNCLAIMED item of this sandbox
app answered `500 INTERNAL_SERVICE_ERROR` once the batch was processed (for example debug ids `f65657708a342` and
`f223396ffb491`). Before that it answers `BATCH_NOT_COMPLETED`. The request follows the API reference: no body, a
bearer token. The app sends the call, shows PayPal's answer with the debug id, changes nothing locally and suggests
holding the next payout instead. If the sandbox starts cancelling, nothing needs changing: the same button then
returns the money, marks the item RETURNED and frees the job to be paid again. Replay has no recording for this call,
because a success was never observed.

## Sandbox balance

Every live run pays about $86 from the sandbox business balance. If it runs low, add funds to the business account
in the PayPal developer dashboard.

## Sandbox logins

The app needs no login. The seed's sandbox logins are not in this repository.
