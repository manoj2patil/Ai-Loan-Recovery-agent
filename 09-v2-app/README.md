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
