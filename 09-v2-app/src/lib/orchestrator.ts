// src/lib/orchestrator.ts — Phase 3: the outreach state machine. For each overdue loan it
// asks the business-rules engine what is due, then executes each action THROUGH the
// Compliance Gate. The gate always has the veto; every action (or veto) is logged.

import { listLoans, findLoanByLoanId, guarantorsForLoan, updateGuarantor,
         recentInteractions, queueHandoff, logInteraction, findCustomerById,
         voiceHistory } from "./db";
import { rulesDueForLoan } from "./business-rules";
import { sendNotice } from "./whatsapp";
import { placeCall } from "./voice";
import { scheduleVisit, shouldScheduleVisit } from "./field-visits";
import { createCase } from "./legal-tracker";
import { listLegalCases } from "./db";
import { cfg } from "./config";
import { BusinessRule } from "./store";

export interface CycleAction {
  loanId: string; rule: string; action: BusinessRule["action"];
  result: "EXECUTED" | "GATED" | "SKIPPED"; detail: string;
}

/** Guarantor escalation (BUILD_STEPS Step 12): only at/over the config threshold, only a
 *  registered guarantor (whitelist), only with the guarantor's own channel consent. */
export async function escalateToGuarantor(loanId: string, by: string): Promise<{ escalated: boolean; detail: string }> {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  if (loan.dpd < cfg.guarantorDpdThreshold())
    return { escalated: false, detail: `dpd ${loan.dpd} below threshold ${cfg.guarantorDpdThreshold()}` };

  const candidates = guarantorsForLoan(loan.id);
  if (candidates.length === 0) return { escalated: false, detail: "no registered guarantor" };

  const consenting = candidates.find((g) => g.consentVoice.granted || g.consentWhatsapp.granted);
  if (!consenting) return { escalated: false, detail: "no guarantor consent on any channel" };
  if (consenting.escalationStatus === "NOTIFIED")
    return { escalated: false, detail: "guarantor already notified" };

  updateGuarantor(consenting.id, { escalationStatus: "NOTIFIED", lastEscalatedAt: new Date().toISOString() });
  logInteraction({
    customerId: loan.customer.id, loanId: loan.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "GUARANTOR_ESCALATED",
    details: { guarantorId: consenting.guarantorId, relationship: consenting.relationship, by },
  });
  // The actual guarantor contact goes out via the consented channel (voice shown here).
  if (consenting.consentVoice.granted) {
    await placeCall(loanId, { toGuarantorPhone: consenting.phone, intentNote: "guarantor escalation" });
  }
  return { escalated: true, detail: `guarantor ${consenting.guarantorId} (${consenting.relationship}) notified` };
}

async function executeRule(loanId: string, rule: BusinessRule): Promise<CycleAction> {
  const base = { loanId, rule: rule.id, action: rule.action };
  const loan = findLoanByLoanId(loanId)!;

  switch (rule.action) {
    case "WHATSAPP": {
      const res = await sendNotice(loanId, rule.template);
      return res.sent
        ? { ...base, result: "EXECUTED", detail: `sent ${res.template}` }
        : { ...base, result: "GATED", detail: res.gate.blockedBy ?? res.gate.verdict };
    }
    case "VOICE": {
      const res = await placeCall(loanId, { intentNote: rule.name });
      return res.placed
        ? { ...base, result: "EXECUTED", detail: `call ${res.callId} (${res.language})` }
        : { ...base, result: "GATED", detail: res.gate.blockedBy ?? res.gate.verdict };
    }
    case "GUARANTOR": {
      const res = await escalateToGuarantor(loanId, "orchestrator");
      return { ...base, result: res.escalated ? "EXECUTED" : "SKIPPED", detail: res.detail };
    }
    case "FIELD_VISIT": {
      const voice7d = recentInteractions(loan.customer.id, "VOICE", 7);
      const contact = {
        voiceAttempts7d: voice7d.length,
        voiceConnected7d: voice7d.filter((i) => !["NO_ANSWER", "CALL_INITIATED"].includes(i.outcome)).length,
        whatsappDelivered7d: recentInteractions(loan.customer.id, "WHATSAPP", 7).length,
      };
      if (!shouldScheduleVisit(loan, contact))
        return { ...base, result: "SKIPPED", detail: "phone channels not exhausted" };
      const res = await scheduleVisit({
        loanId, agentId: "FA01",
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        address: "registered address (CBS)",
      });
      return res.visit
        ? { ...base, result: "EXECUTED", detail: `visit ${res.visit.id}` }
        : { ...base, result: "GATED", detail: res.gate.blockedBy ?? res.gate.verdict };
    }
    case "SARFAESI": {
      // Draft-only from orchestration: opens the case at NOTICE_DRAFTED. Serving the notice
      // and any 13(4) action require the compliance role via the legal routes (human).
      if (!["HOME", "HOMELOAN", "GOLD", "AUTO", "MSME", "MSMELOAN", "AGRICULTURE", "TWOWHEELER"].includes(loan.productType))
        return { ...base, result: "SKIPPED", detail: `unsecured product ${loan.productType}` };
      if (listLegalCases().some((c) => c.loanId === loanId && c.type === "SARFAESI"))
        return { ...base, result: "SKIPPED", detail: "SARFAESI case already open" };
      const c = createCase({ loanId, customerId: loan.customer.id, type: "SARFAESI", by: "orchestrator" });
      return { ...base, result: "EXECUTED", detail: `case ${c.id} drafted (human approval to serve)` };
    }
    case "HUMAN_HANDOFF": {
      const disputes = recentInteractions(loan.customer.id, "VOICE", 30)
        .concat(recentInteractions(loan.customer.id, "WHATSAPP", 30))
        .filter((i) => ["DISPUTE", "HARDSHIP"].includes(i.outcome));
      // Phase 2 emotion → handoff: sustained negative emotion on recent calls routes to a human.
      const distressed = voiceHistory(loan.customer.id)
        .filter((v) => Date.parse(v.startedAt) > Date.now() - 30 * 86400000)
        .some((v) => (v.sentimentScore ?? 0) <= -0.6);
      const reason = disputes.length ? "dispute/hardship raised"
        : distressed ? "negative emotion on recent calls — human empathy required"
        : "NPA review";
      queueHandoff(loanId, loan.customer.id, reason);
      return { ...base, result: "EXECUTED", detail: `queued for human officer (${reason})` };
    }
  }
}

/** One orchestration cycle over the overdue book (idempotence comes from the gate's
 *  frequency caps + per-rule guards, so re-runs don't spam). `limit` bounds a demo run. */
export async function runCycle(limit = 50): Promise<{ actions: CycleAction[]; summary: Record<string, number> }> {
  const actions: CycleAction[] = [];
  const overdue = listLoans()
    .filter((l) => l.dpd > 0)
    .sort((a, b) => b.dpd - a.dpd)
    .slice(0, limit);

  for (const loan of overdue) {
    const customer = findCustomerById(loan.customerId);
    if (!customer) continue;
    for (const rule of rulesDueForLoan(loan)) {
      try {
        actions.push(await executeRule(loan.loanId, rule));
      } catch (e) {
        // A live-dispatch failure (trunk down, egress blocked, provider 4xx) must not
        // abort the cycle — record it and keep working the book.
        actions.push({
          loanId: loan.loanId, rule: rule.id, action: rule.action,
          result: "SKIPPED", detail: `dispatch error: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`,
        });
      }
    }
  }
  const summary: Record<string, number> = {};
  for (const a of actions) summary[a.result] = (summary[a.result] ?? 0) + 1;
  logInteraction({
    customerId: "system", channel: "SYSTEM", direction: "INTERNAL",
    outcome: "ORCHESTRATOR_CYCLE", details: { loans: overdue.length, ...summary },
  });
  return { actions, summary };
}
