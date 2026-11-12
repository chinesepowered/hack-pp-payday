# Devpost draft

## Project name

Payday

## Tagline

Same-day pay for gig workers on small marketplaces: PayPal Payouts the moment a job is verified, and an AI auditor that catches payout mistakes before they cost money.

## Inspiration

Small service marketplaces (home cleaning, dog walking, tutoring, local delivery) usually pay their workers by hand: a
spreadsheet, a batch upload, once a week if someone remembers. Workers wait days for money they earned today. And the
manual process makes expensive mistakes that nobody notices until a worker complains or the balance looks wrong: a
batch uploaded twice, a decimal slip, a mistyped email, money sitting unclaimed. We wanted to show that PayPal Payouts
plus a careful AI can make "paid the day the job is done" the default for a 50-person marketplace, not only for the
giants.

## What it does

Payday is the payouts desk for a small marketplace. The demo runs TidyNest, a fictional home cleaning marketplace.

- **Job complete.** A worker submits the completion checklist and photos. A vision model reads every photo; code checks
  the photos against the checklist and the job record (check-in time, time on site, location). The job is marked
  Verified or Needs review, with reasons.
- **Pay now.** A verified job is paid at once through PayPal Payouts. The worker sees "Paid $86.00, 18 seconds after
  you finished", and Rio the capybara courier tells them out loud.
- **Watchdog.** Rules watch every payout and job for duplicates, overpayments, a payout email changed right before a
  payout, two jobs at once in different places, unclaimed payouts and hours spikes. AI explains each finding and
  drafts the message to the worker. The operator approves the action: hold the next payout, cancel the unclaimed item,
  or message the worker.
- **Dashboard.** The operator's live payouts dashboard is built in AG Studio, with custom widgets (anomaly feed with
  working approve buttons, time-to-pay distribution, worker earnings), the app's theme and three layout presets.
- **Payout auditor.** A custom agent in the AG Studio Agent Framework. Ask "why did payouts spike on Tuesday?" and it
  queries the data, finds the manual batch that was sent twice, and has Studio build the widgets that prove it.
- **Under the hood.** A drawer lists every PayPal call the session made, with its `PayPal-Debug-Id`.
- **Replay mode** runs the main flow from recorded real responses when the sandbox or the model is down.

## How we built it

- **Next.js 16 (App Router), TypeScript, Tailwind 4, pnpm**, deployable to Vercel as is. State is a small JSON document
  store (files locally, Vercel Blob when deployed); PayPal stays the source of truth for money.
- **PayPal.** Payouts (create batch, get batch, get item, cancel item) over REST with a shared OAuth helper and a
  `PayPal-Request-Id` on every POST; Orders through `@paypal/paypal-server-sdk`; Balances and Transaction Search for
  the balance check and reconciliation; webhooks with signature verification and idempotent handlers, plus polling so
  nothing depends on delivery; `pnpm seed` creates the sandbox data through the API.
- **AI.** W&B Inference: `google/gemma-4-31B-it` reads the photos, `Qwen/Qwen3.8-27B` explains anomalies and runs the
  agents, `zai-org/GLM-5.3-Flash` is the fallback. Money decisions are deterministic code with 26 Vitest tests.
- **AG Studio.** Started from PayPal's AG Grid boilerplate. Eight data sources, four custom widgets, a theme built on
  the app's design tokens, layout presets, and a custom harness with our Payout auditor as the primary agent next to
  Studio's five built-in agents.
- **Video.** Recorded from real runs with Playwright, composed with ffmpeg, narrated with ElevenLabs.

## Challenges we ran into

- **The sandbox would not cancel an unclaimed payout.** `POST /v1/payments/payouts-item/{id}/cancel` answered
  `BATCH_NOT_COMPLETED` while the batch was processing and `500 INTERNAL_SERVICE_ERROR` afterwards, every time. We
  decided not to hide it: the app shows PayPal's answer with the debug id, changes nothing, and offers a hold instead.
  The video shows the real outcome.
- **Sandbox timing.** Payouts sit at `PENDING` for 15 to 30 seconds; Balances and Transaction Search lag behind the
  ledger. The app polls, subtracts what it is about to send before comparing with the balance, and labels
  reconciliation rows as "waiting" for three hours instead of "missing".
- **Money in without a browser.** Seeding customers' payments would have meant automating a PayPal approval window.
  Creating the order with a sandbox test card as the payment source captures it in one server call.
- **AG Studio's AI panel lives in edit mode**, and Studio reads `context` once. We open the panel through report state
  and pass the widgets a small store they subscribe to.
- **Docs one version ahead.** The Studio docs describe 3.1.0 while the boilerplate pins 3.0.0; the package's type
  definitions were the reliable reference for the Agent Framework.
- **A model that sometimes returns nothing.** The text model spends small token budgets on reasoning; larger budgets,
  retries, a fallback model and a time limit on explanations keep the desk responsive.

## Accomplishments that we're proud of

- A worker is verified and paid in the PayPal sandbox in about 20 seconds, end to end, live.
- The auditor agent really investigates: it calls tools, cites the numbers, and builds the proof on the dashboard.
- Every money rule is in code and tested; the AI never moves money.
- The Under the hood drawer and Replay mode make the integration inspectable and demo-proof.

## What we learned

- PayPal Payouts is simple to call and subtle to operate: idempotency keys, polling, unclaimed items and lagging
  reports matter more than the happy path.
- An agent is most useful when its tools are narrow and its output is evidence a person can check.
- Honest error handling is a feature. Showing PayPal's debug id beats pretending a cancel worked.

## What's next for Payday

Payouts to Venmo and by phone number, recovering duplicates by offsetting against the next payout with the worker's
consent, webhooks as the primary signal, photo checks against "before" photos, and multi-operator approval for large
batches.

## Built with

Next.js, React, TypeScript, Tailwind CSS, pnpm, PayPal Payouts API, PayPal Orders API, PayPal Transaction Search,
PayPal Webhooks, @paypal/paypal-server-sdk, @paypal/agent-toolkit, AG Studio, AG Studio Agent Framework, AG Grid,
OpenAI SDK, W&B Inference, Vercel, Vercel Blob, Vitest, Playwright, ffmpeg, ElevenLabs

## Tools: which AI models and services were used and how

- **google/gemma-4-31B-it** (W&B Inference): vision. Reads each completion photo and reports the room and whether it
  looks clean.
- **Qwen/Qwen3.8-27B** (W&B Inference): explains watchdog findings, drafts worker messages, and runs the Payout auditor
  and AG Studio's built-in agents through the Responses API with tool calling.
- **zai-org/GLM-5.3-Flash** (W&B Inference): fallback model.
- **ElevenLabs** (`eleven_multilingual_v2`): the video narration and Rio's two pre-rendered voice lines. The hosted app
  never calls ElevenLabs.
- **Claude Code**: used to build the project.
- **APIMatic PayPal Context Plugin** and the **PayPal AI Toolkit** skills: reference while writing the PayPal
  integration.

## PayPal products used

- Payouts API: create batch, get batch, get item, cancel unclaimed item
- Orders API v2 (through the PayPal Server SDK)
- Reporting: Balances and Transaction Search
- Webhooks: registration, signature verification, payout batch and item events
- PayPal Agent Toolkit: `list_transactions`, `get_merchant_insights`
- PayPal sandbox

## Sponsor tools used

- **AG Grid: AG Studio and the Studio Agent Framework.** The operator dashboard (custom widgets, theming, layout
  presets) and the custom Payout auditor agent that works alongside Studio's built-in agents.
- **APIMatic.** The APIMatic-generated PayPal Server SDK for Orders, and the PayPal Context Plugin skills installed in
  the repo and used while building the integration.

## Links

- Hosted demo: https://hack-pp-payday.vercel.app
- Video: https://youtu.be/NccbA07R24I
- Repository: https://github.com/chinesepowered/hack-pp-payday
