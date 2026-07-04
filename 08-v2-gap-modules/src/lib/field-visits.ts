// src/lib/field-visits.ts — Field collections module (Phase 5.5 ★).
// Visit scheduling from the orchestrator, geo-tagged outcome logging, route view data.

export type VisitStatus = "SCHEDULED" | "EN_ROUTE" | "COMPLETED" | "NOT_MET" | "CANCELLED";
export type VisitOutcome = "PAID" | "PTP" | "DISPUTE" | "NOT_FOUND" | "REFUSED" | "LOCKED" | "OTHER";

export interface FieldVisit {
  id: string; loanId: string; customerId: string; agentId: string;
  scheduledFor: Date; status: VisitStatus;
  address: string;
  geo?: { lat: number; lng: number; capturedAt: Date };   // geo-tag at completion (anti-fraud)
  outcome?: VisitOutcome; outcomeNote?: string;
  amountCollected?: number; receiptRef?: string; photoRefs?: string[];
}

/** Orchestrator hook: schedule a visit when 60+ DPD AND phone channels exhausted.
 *  MUST pass the Compliance Gate (channel="visit") — visits obey the same conduct rules. */
export function shouldScheduleVisit(loan: { dpd: number }, contact: {
  voiceAttempts7d: number; voiceConnected7d: number; whatsappDelivered7d: number;
}): boolean {
  return loan.dpd >= 60 && contact.voiceAttempts7d >= 3 && contact.voiceConnected7d === 0;
}

/** Complete a visit with mandatory geo-tag; cash collection requires receiptRef. */
export function completeVisit(v: FieldVisit, res: {
  outcome: VisitOutcome; note?: string; lat: number; lng: number;
  amountCollected?: number; receiptRef?: string; photoRefs?: string[];
}): FieldVisit {
  if (res.amountCollected && !res.receiptRef)
    throw new Error("cash collection requires a receipt reference");
  return {
    ...v, status: res.outcome === "NOT_FOUND" ? "NOT_MET" : "COMPLETED",
    outcome: res.outcome, outcomeNote: res.note,
    geo: { lat: res.lat, lng: res.lng, capturedAt: new Date() },
    amountCollected: res.amountCollected, receiptRef: res.receiptRef, photoRefs: res.photoRefs,
  };
  // caller persists + writes InteractionLog(channel=VISIT) + emits payment.received if collected
}

/** Simple day-route ordering for an agent (nearest-neighbour; replace with real routing later). */
export function orderRoute(visits: FieldVisit[], start: { lat: number; lng: number }) {
  const remaining = visits.filter(v => v.status === "SCHEDULED" && v.geo);
  const route: FieldVisit[] = []; let cur = start;
  while (remaining.length) {
    remaining.sort((a, b) => dist(cur, a.geo!) - dist(cur, b.geo!));
    const next = remaining.shift()!; route.push(next); cur = next.geo!;
  }
  return route;
}
const dist = (a: {lat:number;lng:number}, b: {lat:number;lng:number}) =>
  Math.hypot(a.lat - b.lat, a.lng - b.lng);

// ---------------------------------------------------------------------------
// DND SCRUB — add as a check inside the existing Compliance Gate (src/lib/compliance.ts),
// between the consent check and the frequency-cap check:
//
//   if (await isOnDndRegistry(customer.phone) && !customer.consentVoice?.granted) {
//     return { decision: "BLOCK", reason: "dnd_registry" };
//   }
//
// Note: explicit, recorded consent for account-servicing calls generally overrides DND for
// transactional contact — confirm policy with compliance counsel; keep the check configurable.

export async function isOnDndRegistry(phone: string): Promise<boolean> {
  // Wire to your DND/DNC source: TRAI NCPR lookup via your telco/CPaaS, plus the bank's
  // internal do-not-contact list (suppression table with reason='dnc').
  // const internal = await prisma.suppression.findFirst({ where: { phone, reason: "dnc", active: true }});
  // const ncpr = await telco.checkNcpr(phone);
  return false; // placeholder — MUST be wired before production
}
