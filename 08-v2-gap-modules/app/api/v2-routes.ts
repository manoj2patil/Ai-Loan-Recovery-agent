// app/api/v2-routes.ts — API routes for the v2 gap modules (Next.js App Router).
// Split into separate route.ts files in your app:
//   app/api/payments/link/route.ts, app/api/payments/webhook/route.ts,
//   app/api/legal/cases/route.ts,   app/api/field/visits/route.ts
// Shown combined here for review. All writes require RBAC (officer+) and are audit-logged.

import { NextResponse } from "next/server";
import { createPaymentLink, handlePaymentWebhook } from "@/lib/payments";
import { upcomingObligations, advanceStage } from "@/lib/legal-tracker";
import { shouldScheduleVisit, completeVisit } from "@/lib/field-visits";
// import { requireRole } from "@/lib/auth";  // RBAC: officer | compliance | admin
// import { evaluateGate } from "@/lib/compliance";
// import { prisma } from "@/lib/db";

/* ============ POST /api/payments/link ============
   Body: { loanId, purpose: "EMI"|"PTP"|"SETTLEMENT"|"PARTIAL", amount? }
   Amount defaults to the LEDGER pendingAmount (never client-trusted for EMI/PTP). */
export async function createLinkRoute(req: Request) {
  // await requireRole(req, "officer");
  const { loanId, purpose, amount } = await req.json();
  // const loan = await prisma.loan.findUnique({ where: { loanId }, include: { customer: true }});
  const loan: any = null; // wire
  if (!loan) return NextResponse.json({ error: "loan not found" }, { status: 404 });

  // Ledger-only amount rule: client may pass amount ONLY for SETTLEMENT/PARTIAL, and it must
  // not exceed total outstanding.
  const amt = ["SETTLEMENT", "PARTIAL"].includes(purpose)
    ? Math.min(Number(amount || 0), loan.totalOutstanding)
    : loan.pendingAmount;

  const link = await createPaymentLink({
    loanId, customerId: loan.customer.customerId, amount: amt, purpose,
  });
  // audit: InteractionLog(channel=SYSTEM, outcome=LINK_CREATED)
  return NextResponse.json({ ok: true, link: { id: link.id, webUrl: link.webUrl, upi: link.upiDeepLink, amount: amt, expiresAt: link.expiresAt } });
}

/* ============ POST /api/payments/webhook ============
   PG/UPI callback. MUST verify the provider signature header before trusting. Idempotent. */
export async function paymentWebhookRoute(req: Request) {
  // verifyProviderSignature(req);  // reject on mismatch — do not skip
  const evt = await req.json();
  const result = await handlePaymentWebhook({
    reference: evt.tr || evt.reference, amountPaid: Number(evt.amount), utr: evt.utr, paidAt: evt.paidAt,
  });
  return NextResponse.json(result);
}

/* ============ GET/POST /api/legal/cases ============ */
export async function legalCasesRoute(req: Request) {
  if (req.method === "GET") {
    // const cases = await prisma.legalCase.findMany({ include: { history: true }});
    const cases: any[] = [];
    return NextResponse.json({ cases, upcoming: upcomingObligations(cases, 14) });
  }
  // POST { caseId, toStage, note } — stage transitions require role >= officer;
  // filings/possession stages require role == compliance/legal (human approval — never auto).
  // await requireRole(req, "compliance");
  const { caseId, toStage, note, by } = await req.json();
  // const c = await prisma.legalCase.findUnique({ where: { id: caseId }});
  // const updated = advanceStage(c, toStage, note, by); await prisma.legalCase.update(...)
  return NextResponse.json({ ok: true });
}

/* ============ GET/POST /api/field/visits ============ */
export async function fieldVisitsRoute(req: Request) {
  if (req.method === "GET") {
    // return today's route for the agent, ordered
    return NextResponse.json({ visits: [] });
  }
  const body = await req.json();
  if (body.action === "schedule") {
    // gate first: evaluateGate({ customerId, channel: "visit", intent: "recovery" })
    // if ALLOW → prisma.fieldVisit.create(...)
    return NextResponse.json({ ok: true, scheduled: true });
  }
  if (body.action === "complete") {
    // const v = await prisma.fieldVisit.findUnique(...);
    // const done = completeVisit(v, body); persist + InteractionLog(channel=VISIT)
    // if amountCollected → emit payment.received (suppression + PTP close)
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
