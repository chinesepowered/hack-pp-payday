# Payday (working name)

**PayPal AI Hackathon** (paypalaihackathon.devpost.com). Built in Claude Code web from this repo. This file is the
whole brief: read all of it, including the shared rules at the end, before you start.

**Prize targets:** sponsor prize **AG Grid** (AG Studio and the Studio Agent Framework; $5k, $2k and three $1k
places), Most Impactful. Also eligible for APIMatic.

## The idea

Same-day pay for gig workers on small service marketplaces, with an AI watchdog that catches payout mistakes before
they cost money.

Gig workers on small marketplaces often wait days or weeks to get paid. Small platforms that pay by hand make
expensive mistakes: double payments, wrong emails, money left unclaimed. Payday pays each job the moment it's verified,
through PayPal Payouts. An auditor agent watches every payout and builds the dashboard evidence when something looks
wrong.

**Who it's for:** operators of small service marketplaces (home cleaning, dog walking, tutoring, local delivery) with
20 to 500 workers, and their workers.

**The fictional platform:** "TidyNest", a home-cleaning marketplace. Payday is its payouts desk.

## The flow

1. **Job complete.**
   - A worker submits the completion checklist and photos. Seed photo sets per job type; one set is missing a required
     room.
   - The AI checks the evidence against the job's checklist (vision) and against the job record (scheduled time against
     check-in, location match).
   - It marks the job **Verified** or **Needs review**, with reasons.
2. **Pay now.**
   - Verified jobs are paid at once through PayPal **Payouts**, as single items or in a small batch every few minutes,
     to the worker's PayPal email.
   - The worker view shows: "Paid $86.00, 2 minutes after you finished."
3. **Watchdog.** Rules plus AI watch every payout and job for:
   - a duplicate payout for the same job
   - an amount far above the job's rate
   - a payout email changed right before a large payout
   - two jobs at the same time in different places
   - unclaimed payouts getting old (typo emails)
   - a sudden spike in one worker's hours

   Each anomaly gets a card with the evidence and a suggested action: hold the next payout, cancel an unclaimed item
   (`POST /v1/payments/payouts-item/{id}/cancel`), or message the worker. The operator approves the action.
4. **AG Studio dashboard** (the hero for the sponsor prize). The operator's live payouts dashboard, built in AG Studio:
   - Panels: paid today, median time to pay (job done to payout success), payouts by worker and by day, unclaimed
     money, the anomaly feed, money in from customers against money out to workers, and payout fees.
   - Custom widgets: an anomaly card widget, a time-to-pay distribution, a worker earnings view.
   - Theming in the app's brand, and layout presets.
   - The sponsor wants polish ("custom widgets, theming and layout tools, not just AG Grid or AG Charts on their own"),
     so make it look like a product.
5. **Studio Agent Framework.** Build a custom "Payout auditor" agent that talks to AG Studio's built-in agents, or a
   swapped-in harness, following the AG Studio AI agent docs. The sponsor explicitly asks for this. Examples:
   - The operator asks "why did payouts spike on Tuesday?" The agent queries the data, finds the duplicate batch, and
     has Studio build a widget that shows it.
   - "Show me unclaimed payouts older than 3 days" gives a widget plus suggested cancel actions.

## PayPal integration
- **Payouts:** create a batch, get a batch, get an item, cancel an unclaimed item.
- **Payout webhooks:** `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`,
  `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.CANCELED`.
- **Balances:** `GET /v1/reporting/balances`, to warn before a batch would exceed the balance.
- **Transaction Search:** for reconciliation. It lags up to 3 hours, so explain that in the UI.
- **Orders:** customers' payments into TidyNest, seeded through the API, so the dashboard shows money in and money out.
- **Agent Toolkit tools** where useful: `list_transactions`, `get_merchant_insights`.
- Payouts in the sandbox can sit at PENDING before SUCCESS, so poll.

## AG Studio (the sponsor prize)
- PayPal published a starting point for participants: https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate.
  It's Next 16, `ag-studio` and `ag-studio-react` 3.0.0, and `ag-grid-community`/`ag-grid-react` 36.2.0. Start from its
  patterns and credit it in the README.
- Docs:
  - https://www.ag-grid.com/studio/react/quick-start/
  - https://www.ag-grid.com/studio/react/custom-widgets/
  - https://www.ag-grid.com/studio/react/ai-agents/
- The license comes from `AG_STUDIO_LICENSE` (a 45-day trial key); without it there's a watermark. Pass it to the
  provider the way the boilerplate does.
- AG Studio's AI adapter in the boilerplate targets the OpenAI Responses API. W&B serves that API too, so point the
  adapter's server route at `OPENAI_BASE_URL` with `OPENAI_MODEL`.

## Seed
- TidyNest's business account (with balance) pays workers.
- `PAYPAL_SANDBOX_WORKER_EMAILS` holds three sandbox personal accounts. Add one deliberately mistyped email so a payout
  ends up UNCLAIMED.
- About 40 jobs over the last two weeks, as seeded history labeled "imported history", plus live payouts made during
  the demo.
- Plant three anomalies: a duplicate, an overpayment, and an email change before a payout.

## Mascot
**Rio**, a capybara courier with a satchel. Rio appears in the worker view ("You got paid!") and in the operator's
empty and success states. Keep it professional on the dashboard.

## The aha
1. A worker finishes a job, the AI verifies the photos, and PayPal pays out in seconds.
2. Then the auditor spots a duplicate payout, and AG Studio builds the widget that proves it.
3. The operator cancels the unclaimed item in one click.

## Video outline
1. Cold open: a worker waiting for pay.
2. The job is verified and Payouts fires, with the calls named in Under the hood.
3. The worker sees the money.
4. The operator's AG Studio dashboard.
5. Ask the auditor, and Studio builds the widget.
6. Act on an anomaly.
7. One limitation.
8. End card.

## Keys for this build
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox app `hack-pp-payday`, with Payouts and Transaction search
  enabled), `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same value as the client id), `PAYPAL_ENVIRONMENT=sandbox`.
- `PAYPAL_SANDBOX_WORKER_EMAILS`: three sandbox personal emails, comma-separated.
- `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD`: a customer, if a flow needs a PayPal approval.
- `AG_STUDIO_LICENSE`.
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_FALLBACK_MODEL`.
- `ELEVENLABS_API_KEY`.
- Generate yourself: `DEMO_ADMIN_TOKEN`.

## Cut first if short on time
The worker earnings view, the money-in panel, the location check.

---

## Shared rules (all six PayPal builds)

Six different builds from the same team share these rules. Stay inside this build's idea.

### Deadline and split
- Devpost submissions close **Thu Nov 12 2026, 12:00 PM PT**. Push the finished app, README, screenshots, Devpost
  drafts and the video to `main` by **Wed Nov 11, 9:00 PM PT**. If something isn't done by then, push what works and keep
  going; the local session takes the last push before 6:00 AM PT Thu.
- Suggested order: **Mon Nov 9** the PayPal flow working end to end in the sandbox, the seed script and the AI core;
  **Tue Nov 10** the sponsor tool, the full UI and Replay mode; **Wed Nov 11** polish, tests, screenshots, video, docs.
- You (cloud) build and test everything, record the video and write the docs. The local session deploys to Vercel,
  registers the webhook, uploads the video to YouTube, makes the repo public and submits on Devpost. Don't make the repo
  public, don't deploy and don't submit.
- If you are blocked on something only the user can do (a PayPal dashboard setting, a manual sandbox step), write it at
  the top of `docs/needs-user.md`, mention it in your next message, and carry on with everything else.

### What the hackathon requires
- Meaningful use of at least one PayPal developer technology in the **sandbox**, and meaningful use of AI. A working
  prototype: judges must be able to run or click it (we provide a hosted URL; the README also has full run
  instructions). A design mockup or static prototype doesn't count.
- Public repo with all source, assets and run instructions, and an open-source license GitHub detects. `LICENSE`
  (AGPL-3.0) is already in the repo; add `TRADEMARKS.md` reserving the product name and mascot.
- A demo video under 3 minutes that shows the project working end to end, with no third-party trademarks and no
  copyrighted music. PayPal's own UI is fine (PayPal is the sponsor). Keep other brands' logos out of frame.
- Stage one is pass/fail: the project fits the theme and really uses PayPal. Stage two scores, equally weighted:
  **Technological Implementation** (thorough, skillful, non-trivial use of PayPal and AI), **Design** (a complete,
  coherent product, not a proof of concept), **Potential Impact** (a credible, specific problem for a real audience,
  shown being solved), **Innovation**, and **Presentation** (the video shows it working end to end and says who it's for
  and why it matters).
- A project can win one main prize plus one sponsor prize. Every build also uses APIMatic (below), so it stays eligible
  for that sponsor prize on top of its own.
- Sandbox only. Never use live PayPal credentials or real money, and don't sign up for paid services.

### PayPal, done the way PayPal's judges will look for it
- Before writing PayPal code, read the PayPal AI Toolkit: `git clone https://github.com/paypal/AI-Toolkit
  /tmp/paypal-ai-toolkit` and read its skills, especially `paypal-best-practices` and the SDK v5 and v6 references.
- Install APIMatic's PayPal Context Plugin skills for TypeScript into this repo and use them while building the PayPal
  integration: `npx skills add https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal/skills/typescript`
  (if that fails: `npx context-plugins install paypal`, or clone `context-plugins/plugin-marketplace` and read
  `plugins/paypal`). The APIMatic prize is for builds that used the Context Plugin, so say in the README how you used it.
- Server calls: `@paypal/paypal-server-sdk` (2.5.x, generated by APIMatic) wherever it covers the API; plain REST with
  the same OAuth token helper for anything it doesn't (Disputes, Payouts, Invoicing, Subscriptions, Webhooks as needed).
  Base URL `https://api-m.sandbox.paypal.com`. Send a `PayPal-Request-Id` on every POST.
- The agent's PayPal tools come from `@paypal/agent-toolkit` (1.11.x) where it has them (orders, refunds, invoices,
  disputes, subscriptions, shipment tracking, transactions). Wrap any tool that moves money so it enforces this app's
  rules in code before PayPal is called. Write your own tools for the rest.
- Browser checkout: PayPal **JS SDK v6** where it supports the flow. If a flow isn't in v6 yet (check the toolkit's
  references), use v5 for that flow and say why in the README.
- Webhooks: `/api/paypal/webhook` with signature verification (`POST /v1/notifications/verify-webhook-signature`) and
  idempotent handlers, plus `pnpm paypal:webhook <public-url>`, which registers the URL and this build's event types
  through the API and prints the webhook id (the local session runs it after deploying). Never depend on delivery
  alone: also poll PayPal whenever a screen needs fresh state, so everything works without a public URL.
- Seed data: `pnpm seed` creates this build's realistic sandbox data through the API (idempotent, safe to re-run) and
  prints what it made. Where a step needs the buyer to approve in PayPal's window, automate it with Playwright using
  the sandbox buyer login. Sandbox facts: transaction search lags up to about 3 hours; authorizations are honored for 3
  days and valid for 29 (reauthorize when capturing after day 3); a payout to an email with no PayPal account stays
  UNCLAIMED.
- Make the PayPal work visible: an **Under the hood** drawer listing every PayPal call the current session made (method,
  path, status, `PayPal-Debug-Id`, which feature triggered it), and a small "AI" tag on every AI-produced output naming
  the model.

### AI
- Free W&B Inference, OpenAI-compatible: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (`Qwen/Qwen3.8-27B`; tool
  calling works), `OPENAI_VISION_MODEL` (`google/gemma-4-31B-it`), and `OPENAI_FALLBACK_MODEL`
  (`zai-org/GLM-5.3-Flash`; it always returns `reasoning`, so budget `max_tokens` and handle `content: null`). Both Chat
  Completions and the Responses API answer. Server-side only, `maxRetries: 4`, 60 s timeout (about 1 call in 20 fails
  without retries); fall back to the fallback model after repeated failures.
- Use the Vercel AI SDK (or the OpenAI SDK) with tool calling. Money decisions stay deterministic: the model proposes,
  code checks the rules, and a person approves wherever this brief says so. Log each agent step so the UI can show its
  reasoning trail.
- Rate-limit AI routes per IP on the hosted demo.

### Hosting and state (the local session deploys to Vercel)
- Next.js (App Router) + TypeScript + **pnpm**, deployable to Vercel as is: no long-running processes, webhooks and jobs
  are API routes, and browser-only components (Bryntum, cameras) load with `dynamic(..., { ssr: false })`.
- Persist app state through one small `lib/store.ts` (JSON documents by key): files under `.data/` in development,
  Vercel Blob (`@vercel/blob`) when `BLOB_READ_WRITE_TOKEN` is set (the local session creates the store when deploying).
  PayPal stays the source of truth for money: store PayPal ids and re-read status from PayPal.
- A protected `POST /api/admin/reset` (header `x-admin-token`, checked against `DEMO_ADMIN_TOKEN`) that restores the
  seeded demo state, so judges land on a clean demo.
- A clearly labeled **Replay** mode that runs the main flow from recorded real sandbox and AI responses (fixtures in the
  repo), for when the sandbox or the model is down. Live is the default.

### Keys (environment variables, never in the repo)
- The keys for this build are listed in its section above. Everything is server-side except `NEXT_PUBLIC_*`. Generate
  any secrets the brief says to generate yourself, and keep them only in `.env.local`.
- `.env*` is git-ignored; `.env.example` lists the names only, with a comment on where each comes from.
- Before the last push, check the whole history for every key value in your environment:
  `for v in $(env | grep -E '^(PAYPAL_CLIENT_SECRET|PAYPAL_SANDBOX_BUYER_PASSWORD|OPENAI_API_KEY|ELEVENLABS_API_KEY|CHANNEL3_API_KEY|AG_STUDIO_LICENSE)=' | cut -d= -f2-); do git grep -nF "$v" $(git rev-list --all) && echo LEAK; done`
  must print nothing.

### Git
- Before the first commit: `git config user.name "chinesepowered"` and
  `git config user.email "22500229+chinesepowered@users.noreply.github.com"`. No `Co-Authored-By` or other AI
  attribution lines in commit messages.
- Commit to `main` and push to `origin main` at least every couple of hours. If the session makes you work on a
  `claude/*` branch, merge it into `main` at the end and delete the branch.

### Writing and quality
- **No em dashes** anywhere: UI, README, docs, commit messages, narration.
- Statistics only with a fetched, cited source (list the sources in the README). All people, businesses and products are
  fictional; stock photos only with a license that allows it, credited in `docs/CREDITS.md`.
- Mobile-first and responsive. Accessible to WCAG 2.2 AA (contrast, focus states, labels, keyboard use, live regions
  for async updates); say what you did in the README.
- `pnpm build`, `pnpm lint` and `pnpm test` (Vitest, covering the deterministic money rules) must pass.
- Keep `docs/build-log.md`: dated notes of PayPal and sponsor-tool surprises, walls and workarounds. It feeds the
  Devpost "challenges" section.

### Mascot
- An original capybara character, drawn as SVG by you. No third-party art, and nothing resembling Kapibara-san or any
  other existing character. It has a job in the product (persona, voice, empty, loading and success states) and its
  own name and look, described in this build's section. On business screens, keep it a light touch.

### Deliverables
1. The working app, live against the sandbox, plus Replay mode.
2. `README.md` for judges: a one-line pitch; the problem and who it's for; the aha; a 60-second tour with screenshots;
   how it works (a Mermaid architecture diagram); **every PayPal API and feature used, endpoint by endpoint, and where
   in the code**; the AI: which models, for what, and the guardrails; the sponsor tools (APIMatic plus this build's
   sponsor tool, if any) and how they were used; how to run it locally (sandbox app setup, env vars, `pnpm seed`);
   sandbox test logins for judges (sandbox only, no real money); limitations and what's next; credits; license.
3. `docs/screenshots/*.png`: 6 or more real app states at 1440x960.
4. `docs/devpost.md`: project name; a tagline under 200 characters; inspiration; what it does; how we built it;
   challenges; accomplishments; what we learned; what's next; a built-with list; "Tools: which AI models and services
   were used and how"; PayPal products used; sponsor tools used.
5. **The video:** `demo/video.mp4` (1920x1080 H.264, under 3:00, aim for 2:20 to 2:45, under 50 MB) plus
   `demo/thumb.png` (1200x800) and `demo/narration.txt`.
   - Record real runs of the app with Playwright (headless Chromium, `recordVideo`). Render title and caption cards
     from HTML. Compose with ffmpeg.
   - Narrate with ElevenLabs (`ELEVENLABS_API_KEY`, model `eleven_multilingual_v2` or newer, narrator voice
     `nPczCjzI2devNBz1zQrb`). The mascot may speak short lines in a different premade voice.
   - Structure: a 10-second cold open on the problem; who it's for; the flow end to end with money visibly moving in
     PayPal; the AI doing work a person would otherwise do; PayPal APIs named on screen as they're used; the sponsor
     tool on screen; one honest limitation; an end card with the name.
   - No music, unless you generate it with ElevenLabs on this key; keep any music quiet under the voice.
   - Budget: **under 15,000 ElevenLabs characters for this build in total**. Pre-render the mascot's in-product voice
     lines into `public/audio/`, so the hosted demo never calls ElevenLabs.
   - If you can't produce the video, write `docs/demo-script.md` instead (scenes, exact clicks, narration per scene)
     and put stable `data-testid` attributes on everything it touches.
6. Your last message: what works and what doesn't; how to deploy (env vars, Blob, `pnpm seed`, `pnpm paypal:webhook`);
   which sandbox accounts the seed uses; ElevenLabs characters used; where the video is.
