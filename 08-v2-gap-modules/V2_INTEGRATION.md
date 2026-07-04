# V2 Gap Modules — Integration Guide (non-destructive)

New code implementing the ROADMAP_V2 ★ items, in your app's existing pattern
(Next.js App Router + `src/lib/*.ts` + section components). All ADDITIVE — nothing existing changes.

## Files
```
src/lib/payments.ts        Payment links (UPI+web), webhook reconciliation, auto-suppression,
                           receipts, on-call payment  (Phase 3 ★ — wire FIRST, highest ROI)
src/lib/legal-tracker.ts   SARFAESI/Sec138/Arbitration cases, hearing calendar, statutory
                           clocks (13(2) 60d, Sec138 15d/30d), advocate performance (Phase 5.5 ★)
src/lib/field-visits.ts    Visit scheduling rule, geo-tagged completion, route ordering,
                           + DND-scrub check for the Compliance Gate (Phase 5.5 ★ / Phase 1 ★)
app/api/v2-routes.ts       Route handlers — split into route.ts files as commented
components/V2Sections.tsx  UI section with Payments / Legal / Field tabs
ROADMAP_V2.md              The committee-ready roadmap
```

## Prisma schema additions
```prisma
model PaymentLink {
  id         String   @id
  loanId     String
  customerId String
  amount     Float
  purpose    String   // EMI | PTP | SETTLEMENT | PARTIAL
  status     String   @default("CREATED") // CREATED | PAID | EXPIRED | FAILED
  utr        String?
  expiresAt  DateTime
  createdAt  DateTime @default(now())
}
model UnmatchedPayment { id String @id @default(cuid()); reference String; amount Float; utr String?; raw Json; createdAt DateTime @default(now()) }
model LegalCase {
  id String @id @default(cuid()); loanId String; customerId String
  type String; stage String; noticeDate DateTime?; statutoryDeadline DateTime?
  nextHearing DateTime?; court String?; caseNumber String?; advocateId String?
  documents Json?; createdAt DateTime @default(now())
}
model LegalCaseHistory { id String @id @default(cuid()); caseId String; stage String; note String; by String; at DateTime @default(now()) }
model FieldVisit {
  id String @id @default(cuid()); loanId String; customerId String; agentId String
  scheduledFor DateTime; status String @default("SCHEDULED")
  address String; lat Float?; lng Float?; geoAt DateTime?
  outcome String?; outcomeNote String?; amountCollected Float?; receiptRef String?; photoRefs Json?
}
```

## Wiring order
1. `prisma migrate` the models above; keep existing tables untouched.
2. **Payments first:** implement the two routes (`/api/payments/link`, `/api/payments/webhook`),
   set `PAYMENT_LINK_SECRET`, `BANK_VPA`, `APP_URL`; connect your PG/UPI provider's webhook and
   VERIFY its signature. Test: link → sandbox pay → webhook → suppression created + PTP KEPT +
   receipt template sent + InteractionLog rows.
3. Add the **DND scrub** check into `src/lib/compliance.ts` between consent and freq-cap
   (snippet at the bottom of `field-visits.ts`); wire `isOnDndRegistry` to your telco/NCPR source.
4. **Legal tracker:** routes + cron that emails/queues `upcomingObligations(…, 14)` daily.
   Enforce role `compliance/legal` on filing/possession transitions (human approval — never auto).
5. **Field visits:** orchestrator hook — on DPD_60 event where `shouldScheduleVisit()` is true and
   gate ALLOWs channel `visit`, create a FieldVisit. `payment.received` from a visit collection
   flows through the same suppression path as the webhook.
6. Mount `<V2Sections />` on the dashboard next to your Intelligence section.
7. RBAC: guard all v2 write routes (`requireRole`), mask PII in list views, audit every write.

## Emergent prompt (paste)
```
Add the v2 gap modules to my existing app WITHOUT modifying existing sections. New branch
"v2-gap-modules"; commit current state first. Use the provided files as the implementation:
src/lib/payments.ts, src/lib/legal-tracker.ts, src/lib/field-visits.ts, app/api/v2-routes.ts
(split into route.ts files), components/V2Sections.tsx, plus the Prisma models in
V2_INTEGRATION.md. Wire payments end-to-end first (link → webhook → suppression → receipt →
InteractionLog), then the DND check inside the existing compliance gate, then legal + field.
All writes RBAC-guarded and audit-logged. Acceptance: sandbox payment closes a PTP and blocks
further outreach; legal dashboard shows a hearing within 14 days; a completed visit with cash
requires a receipt ref and logs channel VISIT.
```

## Compliance notes
- Statutory day-counts in `legal-tracker.ts` are encoded per current practice — **have the bank's
  counsel confirm** before go-live.
- Payment amounts: EMI/PTP amounts are ledger-derived server-side; only settlement/partial accept
  a client amount, capped at total outstanding.
- Visits obey the same conduct rules: gate channel `visit`, ID card + civil hours, no coercion.
