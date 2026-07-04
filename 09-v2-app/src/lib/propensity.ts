// src/lib/propensity.ts — Phase 4 intelligence: 6-factor EXPLAINABLE propensity-to-pay,
// settlement recommender, and the best-time/best-channel model (ROADMAP v2 ★). Every score
// ships with its factor breakdown — explainability is the differentiator vs black boxes.

import { findLoanByLoanId, voiceHistory, whatsappHistory, listLoans } from "./db";
import { getDb } from "./store";
import { classify } from "./portfolio";

export interface Factor { name: string; weight: number; score: number; evidence: string }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export interface ExtendedSignals {
  paymentVelocity90d: number;
  timeOfDayAnswerRates: Record<number, number>;
  geo: { city: string | null; state: string | null };
  productType: string;
}

/** 6 factors, weighted to 100. Grounded in ledger + interaction history only. */
export function propensityScore(loanId: string): {
  score: number; segment: string; factors: Factor[]; extendedSignals: ExtendedSignals;
} {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const c = loan.customer;
  const calls = voiceHistory(c.id);
  const msgs = whatsappHistory(c.id);
  const logs = getDb().interactionLogs.filter((i) => i.customerId === c.id);
  const ptps = getDb().ptps.filter((p) => p.customerId === c.id);

  // 1. Repayment progress (25) — how much of the schedule has been serviced
  const paidRatio = loan.tenureMonths ? 1 - loan.pendingInstallments / loan.tenureMonths : 0;
  const f1: Factor = {
    name: "repayment_progress", weight: 25, score: clamp(paidRatio * 100),
    evidence: `${loan.tenureMonths - loan.pendingInstallments}/${loan.tenureMonths} installments serviced`,
  };

  // 2. Delinquency severity (25, inverse) — deeper DPD = lower propensity
  const f2: Factor = {
    name: "delinquency_severity", weight: 25, score: clamp(100 - (loan.dpd / 720) * 100),
    evidence: `${loan.dpd} DPD, ${classify(loan)}`,
  };

  // 3. Channel responsiveness (15) — answered calls + read messages
  const answered = calls.filter((v) => v.status === "COMPLETED").length;
  const read = msgs.filter((m) => m.readAt).length;
  const attempts = calls.length + msgs.length;
  const f3: Factor = {
    name: "channel_responsiveness", weight: 15,
    score: attempts ? clamp(((answered + read) / attempts) * 100) : 50,
    evidence: `${answered}/${calls.length} calls answered, ${read}/${msgs.length} messages read`,
  };

  // 4. Promise history (15) — kept vs broken PTPs (live) + historic PTP outcomes
  const kept = ptps.filter((p) => p.status === "KEPT").length
    + logs.filter((i) => i.outcome === "PAID" && i.promiseToPayDate).length;
  const made = ptps.length + logs.filter((i) => i.outcome === "PROMISE_TO_PAY").length;
  const f4: Factor = {
    name: "promise_history", weight: 15,
    score: made ? clamp((kept / made) * 100) : 50,
    evidence: `${kept} kept of ${made} promises`,
  };

  // 5. Engagement sentiment (10) — average sentiment across interactions
  const sentiments = logs.map((i) => i.sentimentScore).filter((s): s is number => s != null);
  const avg = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
  const f5: Factor = {
    name: "engagement_sentiment", weight: 10, score: clamp((avg + 1) * 50),
    evidence: `avg sentiment ${avg.toFixed(2)} over ${sentiments.length} interactions`,
  };

  // 6. Exposure pressure (10, inverse) — outstanding vs EMI capacity signal
  const burden = loan.emiAmount ? loan.pendingAmount / (loan.emiAmount * 12) : 10;
  const f6: Factor = {
    name: "exposure_pressure", weight: 10, score: clamp(100 - burden * 10),
    evidence: `pending ₹${loan.pendingAmount.toLocaleString("en-IN")} ≈ ${burden.toFixed(1)}× annual EMI`,
  };

  const factors = [f1, f2, f3, f4, f5, f6];
  const score = clamp(factors.reduce((s, f) => s + (f.score * f.weight) / 100, 0));
  const segment = score >= 65 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";

  // ★ Signal expansion path (ROADMAP Phase 4): behavioral segmentation signals surfaced
  // alongside the 6 scored factors — advisory evidence, kept out of the score until
  // validated on pilot data, so explainability stays intact.
  const paidEvents = logs.filter((i) => i.outcome === "PAYMENT_RECEIVED");
  const answerHours: Record<number, number> = {};
  for (const v of calls.filter((v) => v.status === "COMPLETED")) {
    const h = Math.floor((new Date(v.startedAt).getUTCHours() + 5.5) % 24);
    answerHours[h] = (answerHours[h] ?? 0) + 1;
  }
  const extendedSignals = {
    paymentVelocity90d: paidEvents.filter((p) => Date.parse(p.createdAt) > Date.now() - 90 * 86400000).length,
    timeOfDayAnswerRates: answerHours,
    geo: { city: c.city ?? null, state: c.state ?? null },
    productType: loan.productType,
  };

  return { score, segment, factors, extendedSignals };
}

/** Settlement recommender (the "105B" advisory) — a bounded, policy-shaped starting point.
 *  Board OTS policy governs the final number; this only drafts within its bands. */
export function settlementRecommendation(loanId: string) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const cls = classify(loan);
  const p = propensityScore(loanId);
  // Waiver bands by classification, nudged by propensity (higher propensity → smaller waiver).
  const band = cls === "LOSS" ? [40, 60] : cls === "DOUBTFUL" ? [25, 45] : cls === "SUB_STANDARD" ? [10, 25] : [0, 5];
  const waiverPct = Math.round(band[1] - ((band[1] - band[0]) * p.score) / 100);
  const settlementAmount = Math.round(loan.totalOutstanding * (1 - waiverPct / 100));
  return {
    classification: cls, propensity: p.score,
    waiverPct, settlementAmount,
    rationale: `${cls} asset at ${loan.dpd} DPD with ${p.segment} propensity (${p.score}); ` +
      `policy band ${band[0]}–${band[1]}% waiver → offer ₹${settlementAmount.toLocaleString("en-IN")} ` +
      `(requires officer approval per board OTS policy)`,
  };
}

/** Best-time / best-channel (ROADMAP Phase 4 ★): learn per-borrower contact windows within
 *  legal hours from what actually connected/was read. */
export function bestTimeChannel(loanId: string) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const c = loan.customer;
  const calls = voiceHistory(c.id);
  const msgs = whatsappHistory(c.id);

  const hourScore: Record<number, number> = {};
  for (const v of calls.filter((v) => v.status === "COMPLETED"))
    hourScore[new Date(v.startedAt).getUTCHours()] = (hourScore[new Date(v.startedAt).getUTCHours()] ?? 0) + 2;
  for (const m of msgs.filter((m) => m.readAt))
    hourScore[new Date(m.readAt!).getUTCHours()] = (hourScore[new Date(m.readAt!).getUTCHours()] ?? 0) + 1;

  // Only windows inside legal calling hours qualify.
  const legal = Object.entries(hourScore)
    .map(([h, s]) => ({ hourIst: (Number(h) + 5.5 + 24) % 24, s }))
    .filter((x) => x.hourIst >= 9 && x.hourIst < 19)
    .sort((a, b) => b.s - a.s);
  const bestHour = legal[0] ? Math.floor(legal[0].hourIst) : 11; // default late morning

  const answeredRate = calls.length ? calls.filter((v) => v.status === "COMPLETED").length / calls.length : 0;
  const readRate = msgs.length ? msgs.filter((m) => m.readAt).length / msgs.length : 0;
  const channel = readRate > answeredRate ? "whatsapp" : "voice";
  return {
    bestWindowIst: `${bestHour}:00–${bestHour + 2}:00`,
    channel,
    evidence: `answer rate ${(answeredRate * 100).toFixed(0)}% (${calls.length} calls), ` +
      `read rate ${(readRate * 100).toFixed(0)}% (${msgs.length} messages)`,
  };
}

/** Book-level segments for the dashboard. */
export function propensitySegments() {
  const out: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const l of listLoans().filter((l) => l.dpd > 0)) {
    try { out[propensityScore(l.loanId).segment]++; } catch { /* skip orphans */ }
  }
  return out;
}
