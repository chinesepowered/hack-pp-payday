# Build log

Dated notes of PayPal and sponsor-tool surprises, walls and workarounds.

## Wed Nov 11 2026

- **Payouts in the sandbox:** `POST /v1/payments/payouts` returns `PENDING` at once; items reached `SUCCESS` after 15 to 30 seconds of polling `GET /v1/payments/payouts/{id}`. A payout to an email with no PayPal account settled as `UNCLAIMED` in the same window. The app polls instead of waiting for webhooks.
- **Orders without a browser:** an order created through `@paypal/paypal-server-sdk` with a sandbox test card as `payment_source.card` is created and captured in one call (`COMPLETED`, with the fee breakdown). That let the seed create real money-in without Playwright and the buyer login.
- **Balances lag:** `GET /v1/reporting/balances` carries an `as_of_time` that trails the ledger, so after paying out the reported balance was unchanged for a while. The pay rule therefore subtracts what the current batch is about to send before comparing.
- **Transaction Search lag:** `GET /v1/reporting/transactions` showed zero items for payouts made minutes earlier. The reconciliation panel labels such rows "waiting for Transaction Search" until they are three hours old.
- **Agent Toolkit:** `get_merchant_insights` answers "not supported in sandbox mode". The auditor keeps the tool but reports that answer honestly; `list_transactions` works.
- **APIMatic Context Plugin:** `npx skills add .../plugins/paypal/skills/typescript` installed nine skills into `.agents/skills`. The Server SDK it documents covers Orders but not Payouts, Reporting or Webhooks, so those are plain REST with one shared token helper.
- **Vision check:** `google/gemma-4-31B-it` named all nine seeded room photos correctly in about 1.5 s for the set. The model only reports what it sees; code compares that with the checklist.
- **Text model:** `Qwen/Qwen3.8-27B` sometimes returns empty `content` when `max_tokens` is small (the budget goes to reasoning). Raising the budget fixed it; the fallback model covers the rest.
