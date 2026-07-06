# Sah-Ayak Recovery Console — the full app (frontend + backend)

One Next.js deployable: React console (frontend) + App Router API routes (backend), seeded
from the real CBS export. Implements the v1 operational phases from
[`../04-claude-code-build/CLAUDE.md`](../04-claude-code-build/CLAUDE.md) /
[`BUILD_STEPS.md`](../04-claude-code-build/BUILD_STEPS.md) **and** the v2 gap modules from
[`../08-v2-gap-modules/`](../08-v2-gap-modules/).

## v1 — Recovery operations (Phases 1, 3, 4, 5)

- **Portfolio & NPA engine** — book stats, DPD buckets, RBI IRAC reclassification runs
  (compliance role), product mix; SystemConfig-driven thresholds (never hardcoded).
- **Compliance Gate** — ALLOW/DEFER/BLOCK veto on every outreach: suppression flags,
  active suppressions, per-channel consent, ★DND scrub, SystemConfig frequency caps
  (2 calls / 3 WhatsApp per day), calling hours 9–19 IST. Full reason trail, always logged.
- **Business rules** — the 12 default RBI rules across 5 DPD buckets and 6 action types,
  each with its RBI reference; toggleable (compliance role), never deletable.
- **Orchestrator** — one cycle walks the overdue book worst-DPD-first, executes due rules
  through the gate: WhatsApp notices, voice calls, guarantor escalation (consent +
  threshold), field visits (phone-exhausted test), SARFAESI drafting (human serves),
  human handoff queue.
- **WhatsApp notices** — DPD-appropriate approved Utility template in the borrower's
  language (hi/en fallback), ledger-only variables, WhatsappMessage + InteractionLog rows.
- **Voice dispatch** — gated call placement with whitelist (borrower/guarantor only);
  dev = simulated VoiceCall row; production = Twilio Media Streams (folder 06) or
  LiveKit + Sarvam (folders 05/07) via env, per the on-prem swap rule.
- **Intelligence (Phase 4)** — 6-factor **explainable** propensity (every factor ships
  evidence), settlement recommender bounded by classification policy bands, and the
  ★best-time/best-channel model learned from answer/read rates within legal hours.
- **Governance (Phase 5)** — gate-decision and channel-mix KPIs, recovery totals, PTP
  kept-rate, suppressions, handoff queue.

## Phase 6 — Enterprise hardening

- **Session auth** — `/api/auth` login/logout with scrypt-hashed users (`officer1` /
  `compliance1` / `admin`, default password `ChangeMe123!` — change via `DEFAULT_*_PASSWORD`),
  signed httpOnly cookies, session audit. Set `AUTH_MODE=session` to disable the dev
  `x-role` fallback entirely.
- **Encryption at rest** — set `STORE_ENCRYPTION_KEY` and the store persists as
  AES-256-GCM ciphertext (auto-migrates plaintext on first read).
- **API hardening** — security headers + per-IP rate limiting (middleware.ts).
- **Ops** — `/api/health` (probes) and `/api/metrics` (Prometheus).
- **Campaign auto-dial** — `/api/campaign`: gate-checked segment queue, sequential dialing.
- **Ingestion** — `/api/data/import` CSV upsert (admin) + CBS delta-sync wiring.
- **CI** — `.github/workflows/ci.yml`: typecheck, unit tests (`npm test` — every gate veto
  reason, auth, encryption), build, and the acceptance suite on every push. `Dockerfile`
  at the repo root builds the container.

## v2 — Gap modules (per [`V2_INTEGRATION.md`](../08-v2-gap-modules/V2_INTEGRATION.md))

- **Payments closure (Phase 3 ★)** — signed UPI/web payment links (ledger-only amounts),
  signature-verified webhook, idempotent reconciliation, **auto-suppression on payment**,
  PTP closed as KEPT, receipt via the gated WhatsApp send, unmatched-payment queue,
  on-call payment, borrower-facing `/pay/[id]` page with sandbox gateway.
- **Compliance Gate + DND scrub (Phase 1 ★)** — ALLOW/DEFER/BLOCK with a full reason trail;
  the **DND registry check sits between consent and frequency-cap** as specified; receipts are
  transactional and exempt from paid-suppression/frequency checks.
- **Legal case tracker (Phase 5.5 ★)** — SARFAESI / Sec 138 / Arbitration cases, statutory
  clocks (13(2) 60d, Sec 138 15d/30d), hearing calendar with a 14-day obligations window,
  advocate performance; **filing/possession transitions require the `compliance` role** —
  tracked, never auto-executed.
- **Field visits (Phase 5.5 ★)** — scheduling gated on channel `visit`, mandatory geo-tag at
  completion, **cash requires a receipt reference**, `InteractionLog(channel=VISIT)`, and a
  collection flows through the **same closure path as the webhook**.
- **NACH mandate view (Phase 5.5 ★)** — mandate status per loan (UMRN, cap, bounce count);
  a **bounce raises an orchestrator event** (`EVENT_NACH_BOUNCE`, 3 bounces → EXHAUSTED); a
  successful presentment runs the same payment-closure path as the webhook.
- **RBAC + audit (Phase 1 ★)** — every write route calls `requireRole()`; every write lands in
  the audit log; the Ops tab (compliance role) shows the unmatched-payment queue, the audit
  trail, and recent gate decisions; list/pay views use PII masking helpers.

## Run

```bash
cd 09-v2-app
npm install
cp .env.example .env   # set real secrets outside dev
npm run dev            # seeds the store from ../02-data-and-schema/database-backup.json
```

Open http://localhost:3000 — Payments / Legal Cases / Field Visits tabs.

> Behind a corporate egress proxy (incl. Claude Code cloud environments): start the server
> with `NODE_USE_ENV_PROXY=1` so Node's built-in fetch honors `HTTPS_PROXY` — otherwise
> live Twilio/Sarvam dispatch fails with an allowlist error even when the host is allowed.
Create a link for e.g. `LN500001`, open its web URL, hit **Pay now (sandbox)** and watch the
closure flow (suppression, PTP KEPT, receipt) land in `data/db.json`.

## Acceptance (V2_INTEGRATION criteria)

With the dev server running:

```bash
npm run acceptance
```

Covers: sandbox payment closes a PTP and blocks further outreach · legal dashboard shows a
hearing within 14 days · a completed visit with cash requires a receipt ref and logs channel
`VISIT` — plus webhook signature rejection, idempotency, and the officer/compliance RBAC split.

## Dev store vs production

The dev data layer is a JSON file (`data/db.json`) seeded from the real CBS export, so the app
runs with zero external services. `src/lib/db.ts` is the only file that touches it and every
function maps 1:1 onto a Prisma call — for production, `prisma migrate` the models in
[`prisma/schema.prisma`](prisma/schema.prisma) against PostgreSQL and swap the store import for
the Prisma client. Existing v1 tables are untouched.

## PostgreSQL data layer (production)

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/sahayak
npx prisma db push          # full schema: 12 CBS tables + v2 + platform models
npx tsx prisma/seed.ts      # loads database-backup.json — verifies all 12 row counts
npx tsx --test tests/prisma-parity.test.mts   # proves the adapter matches the JSON store
```

`src/lib/data/prisma-db.ts` is the async PostgreSQL twin of `src/lib/db.ts` — identical
shapes (parity-tested in CI against a postgres service). Libs flip to it import-by-import.

## Turn-by-turn voice conversation (Twilio Gather + Sarvam)

Beyond the one-way spoken reminder, the app runs a real back-and-forth recovery call — the
borrower talks, Asha (female, Sarvam `anushka` voice) replies, negotiates a Promise-to-Pay, and
sends the payment link — over Twilio's `<Gather>` speech loop + Sarvam `sarvam-30b` LLM + Bulbul
TTS. No persistent WebSocket needed, but **Twilio must reach a public `APP_URL`.**

```bash
# 1. expose the app (local dev): install cloudflared, then
cloudflared tunnel --url http://localhost:3000        # prints https://<something>.trycloudflare.com
# 2. in .env:
APP_URL=https://<something>.trycloudflare.com
CONVERSATION_MODE=1
SARVAM_API_KEY=sk_...
SARVAM_REASONING_EFFORT=low        # trims per-turn latency
# 3. restart with NODE_USE_ENV_PROXY=1 and place a call — it's now a live conversation.
```

Human-agent behaviours (verified live):
- **Thinks like a real officer** — the prompt encodes how a skilled human collector works:
  build rapport, listen, diagnose the real blocker (*cannot* pay = cash-flow, vs *will not*
  pay = dispute/avoidance), then handle each differently with a face-saving path, always
  gently closing toward a specific date or amount. Full objection playbook (no money, business
  down, "next month", dispute, "why should I pay", angry).
- **Auto callback** — "I'm in a meeting / travelling / call me tomorrow at 3" → Asha doesn't
  push; a callback is scheduled with the extracted time + reason (`/api/callbacks`, shown in
  Ops), she confirms it and ends politely. The dialer picks up PENDING callbacks at their time.
- **Cross-call memory** — every call writes a one-line summary to SemanticMemory; the next call
  loads the last few notes into the prompt so Asha references the prior discussion ("last time
  you mentioned…"). Seeded from the CBS memory rows.
- **Fraud / trust handling** — "is this a scam?" → calm reassurance: never asks OTP/PIN/card,
  offers the bank's **official number (from SystemConfig)** to verify, never pressures. Routes
  to the 105B model.
- **Smart reluctance handling** — excuses and "won't pay" are met with acknowledge → facts
  once (days overdue, late fee, CIBIL) → offer the easiest next step (part-payment, short
  extension, settlement) → escalate to a human officer if unresolved (handoff queue).

Enterprise capabilities (all verified live against Sarvam):
- **All Indic languages** — the agent is fluent in bn/en/gu/hi/kn/ml/mr/pa/ta/te.
- **Mid-call language switch** — `src/lib/language.ts` detects the borrower's language every
  turn (script-based + Hindi/Marathi disambiguation, instant, no network). If they switch, Asha
  switches with them — the reply, TTS voice, and Twilio's ASR hint all follow. Logged as
  `LANGUAGE_SWITCH`. (Verified: a call opened in Hindi, borrower switched to Marathi, Asha
  replied in Marathi and closed the PTP.)
- **Model tiering** — `sarvam-30b` on the fast hot path; hardship / dispute / settlement /
  frustration turns route to **`sarvam-105b`** (the deep negotiator). ROADMAP Phase 4.
- **Payment confirmation** — if the borrower says they've already paid, Asha thanks them, asks
  for the UPI reference on WhatsApp, and marks it for team verification (no argument).
- **Strict scope** — loan-account only; off-topic questions get one polite redirect, never an answer.
- **Rich WhatsApp close** — on a captured PTP, `sendPaymentMessage` sends the full account
  card (a/c no., pending, EMI, days-overdue + bucket, next due, pay-by date, secure link,
  UPI-reference + `DATE DD/MM` + `STOP` instructions) in the borrower's language, all values
  from the ledger — then a warm goodbye.

Flow: opening (daypart greeting + name + EMI + days overdue, ledger-only) → borrower speaks →
empathetic reply (30b/105b) that mirrors their language and narrows to a concrete date → a
dedicated extractor captures the Promise-to-Pay → PTP recorded + rich WhatsApp payment message →
warm close. Marathi note: Twilio's `<Gather>` ASR is weaker for Marathi than Sarvam saaras —
hi/en are solid; for best-in-class Marathi ASR use the media-stream / Samvaad path
(`MEDIA_STREAM_WSS`), which wins over Gather when set.

Files: `src/lib/sarvam.ts` (30b/105b LLM + TTS + PTP extractor), `src/lib/language.ts` (Indic
detection + WhatsApp localization), `src/lib/conversation.ts` (turn engine: switch, tiering,
payment-confirm, scope, rich close), `src/lib/whatsapp.ts` (`sendPaymentMessage`),
`app/api/voice/turn` (Gather webhook), `app/api/voice/tts` (streams each reply's audio).

## Real telephony (Twilio)

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` and every gated call
(Borrower 360 "Place call", orchestrator, campaigns) dispatches a REAL PSTN call via the
Twilio REST API (inline TwiML — no public webhook needed for the smoke leg). Optional:
`GREETING_AUDIO_URL` (pre-generated Sarvam TTS) plays on answer; `MEDIA_STREAM_WSS`
upgrades the leg to the folder-06 Media Streams bridge for the full conversation;
a public `APP_URL` enables the `/api/voice/status` callback that closes out VoiceCall rows.
TwiML is `<Play>`-only (never `<Say>`) with XML escaping — the VOICE LESSONS are unit-tested.

## Production wiring checklist (from V2_INTEGRATION)

- [ ] Set `PAYMENT_LINK_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `BANK_VPA`, `APP_URL`; point your
      PG/UPI provider's webhook at `/api/payments/webhook` (signature is already enforced).
- [ ] Wire `isOnDndRegistry()` (src/lib/compliance.ts) to your telco/NCPR source; decide
      `DND_CONSENT_OVERRIDE` with compliance counsel.
- [ ] Replace `resolveActor()` (src/lib/auth.ts) with your session/SSO lookup.
- [ ] Cron: email/queue `upcomingObligations(14)` daily to the legal team.
- [ ] Orchestrator: on DPD_60 events call `shouldScheduleVisit()` → `scheduleVisit()`.
- [ ] Remove or env-gate `/api/payments/sandbox-pay`.
- [ ] Statutory day-counts: **have the bank's counsel confirm** before go-live.
