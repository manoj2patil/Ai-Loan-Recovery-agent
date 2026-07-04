// src/lib/nach.ts — NACH mandate view (Phase 5.5 ★): mandate status per loan;
// bounce → orchestrator event. A successful presentment IS a payment, so it flows
// through the same closure path as the PG webhook (suppression, PTP KEPT, receipt).

import {
  insertNachMandate, findNachMandate, findMandateByLoan, updateNachMandate,
  listNachMandates, findLoanByLoanId, logInteraction,
} from "./db";
import { recordCollection } from "./payments";
import { NachMandate } from "./store";

/** Bounces at/over this mark the mandate EXHAUSTED — stop presenting, orchestrator
 *  switches strategy (call → PTP → field). Confirm the number with operations. */
const MAX_BOUNCES = 3;

export function registerMandate(opts: {
  loanId: string; umrn: string; bank: string; amountCap: number; nextPresentation?: string;
}): NachMandate {
  const loan = findLoanByLoanId(opts.loanId);
  if (!loan) throw new Error("loan not found");
  if (findMandateByLoan(opts.loanId)?.status === "ACTIVE")
    throw new Error("loan already has an active mandate");
  const row = insertNachMandate({
    loanId: opts.loanId, customerId: loan.customer.id, umrn: opts.umrn,
    bank: opts.bank, amountCap: opts.amountCap, nextPresentation: opts.nextPresentation,
  });
  logInteraction({
    customerId: loan.customer.id, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "NACH_MANDATE_REGISTERED",
    details: { mandateId: row.id, umrn: opts.umrn, amountCap: opts.amountCap },
  });
  return row;
}

/** Record a presentment result from the sponsor bank file / API. */
export async function recordPresentment(opts: {
  mandateId: string; outcome: "SUCCESS" | "BOUNCE"; amount: number;
  reason?: string;          // bounce reason code (e.g. "01 insufficient funds")
  utr?: string;
}): Promise<{ mandate: NachMandate; action: string }> {
  const m = findNachMandate(opts.mandateId);
  if (!m) throw new Error("mandate not found");
  if (m.status === "CANCELLED") throw new Error("mandate is cancelled");
  if (opts.amount > m.amountCap) throw new Error("presentment exceeds mandate amount cap");

  const now = new Date().toISOString();

  if (opts.outcome === "SUCCESS") {
    updateNachMandate(m.id, { lastOutcome: "SUCCESS", lastPresentedAt: now });
    // Same closure path as the PG webhook: suppression, PTP KEPT, receipt, event.
    await recordCollection({
      loanId: m.loanId, customerId: m.customerId, amount: opts.amount,
      source: "nach", sourceRef: m.umrn, utr: opts.utr || `NACH-${m.umrn}`,
    });
    return { mandate: findNachMandate(m.id)!, action: "presentment_success_closed" };
  }

  // BOUNCE → orchestrator event (ROADMAP: "bounce → orchestrator event")
  const bounceCount = m.bounceCount + 1;
  updateNachMandate(m.id, {
    lastOutcome: "BOUNCE", lastPresentedAt: now, bounceCount,
    status: bounceCount >= MAX_BOUNCES ? "EXHAUSTED" : m.status,
  });
  logInteraction({
    customerId: m.customerId, loanId: m.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "EVENT_NACH_BOUNCE",
    details: {
      mandateId: m.id, umrn: m.umrn, amount: opts.amount, reason: opts.reason,
      bounceCount, exhausted: bounceCount >= MAX_BOUNCES,
    },
  });
  return {
    mandate: findNachMandate(m.id)!,
    action: bounceCount >= MAX_BOUNCES ? "bounced_mandate_exhausted" : "bounced_event_emitted",
  };
}

/** Mandate status per loan for the dashboard. */
export function mandateView() {
  return listNachMandates().map((m) => {
    const loan = findLoanByLoanId(m.loanId);
    return { ...m, dpd: loan?.dpd ?? null, emiAmount: loan?.emiAmount ?? null };
  });
}

export { findMandateByLoan };
