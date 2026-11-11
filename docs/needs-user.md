# Needs the user

Things only the user (or the local session) can do. Newest first.

1. **PayPal sandbox: cancelling an unclaimed payout item returns HTTP 500.** On Wed Nov 11 2026 every call to
   `POST /v1/payments/payouts-item/{id}/cancel` for an UNCLAIMED item of this sandbox app answered
   `500 INTERNAL_SERVICE_ERROR` (for example debug ids `f65657708a342`, `f223396ffb491`), once the batch was processed;
   before that it answers `BATCH_NOT_COMPLETED`. The request follows the API reference (no body, bearer token). The app
   sends the call, shows PayPal's answer with the debug id, changes nothing locally and suggests holding the next
   payout instead. The video shows exactly that. Things only you can try: check the sandbox business account in the
   developer dashboard (confirmed email, Payouts enabled, no account limitation), try again later (it may be a sandbox
   incident), or raise the debug ids with PayPal. If the sandbox starts cancelling, nothing needs changing: the same
   button then returns the money, marks the item RETURNED and frees the job to be paid again. Replay mode has no
   recording for this call, because a success was never observed and fixtures are never invented.
2. **AG Studio licence (optional).** `AG_STUDIO_LICENSE` was blank for this build, so the dashboard shows AG Studio's
   trial watermark, in the app, the screenshots and the video. Set the variable in Vercel (and `.env.local`) when a key
   arrives; no code change is needed.
3. **Deploy and webhook (local session).** After deploying to Vercel with a Blob store attached, run
   `pnpm paypal:webhook https://<deployment>` and set `PAYPAL_WEBHOOK_ID` to the id it prints. The app polls PayPal
   anyway, so it works before this is done.
4. **Seed on the deployment.** Call `POST /api/admin/reset` with header `x-admin-token: $DEMO_ADMIN_TOKEN` once after
   deploying. It restores the demo state in Blob, re-reads the seeded payouts from PayPal and sends a new mistyped
   payout if the last one was cancelled. `DEMO_ADMIN_TOKEN` was generated for this build and lives only in `.env.local`:
   copy it into the Vercel environment.
5. **Sandbox balance.** Every live demo run pays about $86 from the sandbox business balance (it started at $5,000,
   and seeded orders add to it). If it ever runs low, top it up in the PayPal developer dashboard (Sandbox accounts,
   business account, Funding).
