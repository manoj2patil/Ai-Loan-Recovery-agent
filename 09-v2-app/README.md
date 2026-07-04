# Sah-Ayak v2 App — Payments · Legal · Field (wired)

Runnable implementation of the **v2 gap modules** from [`../08-v2-gap-modules/`](../08-v2-gap-modules/),
wired end-to-end per [`V2_INTEGRATION.md`](../08-v2-gap-modules/V2_INTEGRATION.md):

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
