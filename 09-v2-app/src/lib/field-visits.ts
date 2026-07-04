// src/lib/field-visits.ts — Field collections module (Phase 5.5 ★), wired.
// Visit scheduling from the orchestrator, geo-tagged outcome logging, route ordering.
// Visits obey the same conduct rules as calls: gate channel "visit", ID card + civil
// hours, no coercion. Cash collection REQUIRES a receipt reference.

import { insertFieldVisit, findFieldVisit, updateFieldVisit, listFieldVisits, findLoanByLoanId, logInteraction } from "./db";
import { evaluateGate, GateResult } from "./compliance";
import { recordVisitCollection } from "./payments";
import { FieldVisitRow } from "./store";

export type VisitOutcome = "PAID" | "PTP" | "DISPUTE" | "NOT_FOUND" | "REFUSED" | "LOCKED" | "OTHER";

/** Orchestrator hook: schedule a visit when 60+ DPD AND phone channels exhausted. */
export function shouldScheduleVisit(loan: { dpd: number }, contact: {
  voiceAttempts7d: number; voiceConnected7d: number; whatsappDelivered7d: number;
}): boolean {
  return loan.dpd >= 60 && contact.voiceAttempts7d >= 3 && contact.voiceConnected7d === 0;
}

/** Schedule a visit — the Compliance Gate (channel="visit") MUST allow it first. */
export async function scheduleVisit(opts: {
  loanId: string; agentId: string; scheduledFor: string; address: string;
  lat?: number; lng?: number;
}): Promise<{ gate: GateResult; visit?: FieldVisitRow }> {
  const loan = findLoanByLoanId(opts.loanId);
  if (!loan) throw new Error("loan not found");

  const gate = await evaluateGate({ customerId: loan.customer.id, channel: "visit", intent: "recovery" });
  if (gate.verdict !== "ALLOW") return { gate };

  const visit = insertFieldVisit({
    loanId: opts.loanId, customerId: loan.customer.id, agentId: opts.agentId,
    scheduledFor: opts.scheduledFor, status: "SCHEDULED", address: opts.address,
    lat: opts.lat, lng: opts.lng,
  });
  logInteraction({
    customerId: loan.customer.id, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "VISIT_SCHEDULED", gateVerdict: gate.verdict,
    details: { visitId: visit.id, agentId: opts.agentId, scheduledFor: opts.scheduledFor },
  });
  return { gate, visit };
}

/** Complete a visit: mandatory geo-tag (anti-fraud); cash requires receiptRef; logs
 *  InteractionLog(channel=VISIT); a collection flows through the same payment-closure
 *  path as the webhook (suppression + PTP KEPT + receipt). */
export async function completeVisit(visitId: string, res: {
  outcome: VisitOutcome; note?: string; lat: number; lng: number;
  amountCollected?: number; receiptRef?: string; photoRefs?: string[];
}): Promise<FieldVisitRow> {
  const v = findFieldVisit(visitId);
  if (!v) throw new Error("visit not found");
  if (v.status !== "SCHEDULED" && v.status !== "EN_ROUTE") throw new Error(`visit is ${v.status}`);
  if (res.lat == null || res.lng == null) throw new Error("geo-tag is mandatory at completion");
  if (res.amountCollected && !res.receiptRef)
    throw new Error("cash collection requires a receipt reference");

  updateFieldVisit(visitId, {
    status: res.outcome === "NOT_FOUND" ? "NOT_MET" : "COMPLETED",
    outcome: res.outcome, outcomeNote: res.note,
    lat: res.lat, lng: res.lng, geoAt: new Date().toISOString(),
    amountCollected: res.amountCollected, receiptRef: res.receiptRef, photoRefs: res.photoRefs,
  });

  logInteraction({
    customerId: v.customerId, loanId: v.loanId, channel: "VISIT",
    direction: "OUTBOUND", outcome: res.outcome,
    details: {
      visitId, note: res.note, geo: { lat: res.lat, lng: res.lng },
      amountCollected: res.amountCollected, receiptRef: res.receiptRef,
    },
  });

  if (res.amountCollected && res.receiptRef) {
    await recordVisitCollection({
      loanId: v.loanId, customerId: v.customerId,
      amount: res.amountCollected, receiptRef: res.receiptRef,
    });
  }
  return findFieldVisit(visitId)!;
}

export function listVisits(): FieldVisitRow[] {
  return listFieldVisits();
}

/** Simple day-route ordering for an agent (nearest-neighbour; swap for real routing later). */
export function orderRoute(visits: FieldVisitRow[], start: { lat: number; lng: number }) {
  const remaining = visits.filter((v) => v.status === "SCHEDULED" && v.lat != null && v.lng != null);
  const route: FieldVisitRow[] = []; let cur = start;
  while (remaining.length) {
    remaining.sort((a, b) => dist(cur, a) - dist(cur, b));
    const next = remaining.shift()!; route.push(next);
    cur = { lat: next.lat!, lng: next.lng! };
  }
  return route;
}
const dist = (a: { lat: number; lng: number }, b: { lat?: number; lng?: number }) =>
  Math.hypot(a.lat - (b.lat ?? 0), a.lng - (b.lng ?? 0));
