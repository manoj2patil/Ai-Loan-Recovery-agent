// src/lib/qa.ts — Phase 4: call-QA scorecard + per-reply hallucination detection.
// The moat check: every amount the agent SPOKE must exist in the LEDGER. Any spoken figure
// that matches no ledger figure (EMI, outstanding, pending, principal, or a PTP amount) is
// flagged as a hallucination candidate for compliance review. Scorecard also checks the
// conduct rules from the Asha prompt (03-prompts-and-config): identity verification before
// disclosure, no coercive language, and a recorded gate decision.

import { getDb } from "./store";
import { listLoans } from "./db";

const COERCIVE = [
  "jail", "police", "arrest", "seize your", "threat", "blacklist", "shame",
  "जेल", "पुलिस", "गिरफ्तार", "धमकी", "बदनाम",
];
const VERIFY_HINTS = ["aadhaar", "आधार", "last 4", "last four", "verification", "verify", "सत्यापन", "पड़ताळणी"];

export interface CallQa {
  callId: string; loanId?: string; language: string;
  score: number;                       // 0–100
  checks: { name: string; pass: boolean; note: string }[];
  hallucinationFlags: { amount: number; context: string }[];
}

/** Amounts ≥ ₹1,000 spoken in the transcript (skips years/dates/percentages heuristically). */
function spokenAmounts(transcript: string): { amount: number; context: string }[] {
  const out: { amount: number; context: string }[] = [];
  const re = /(?:₹|rs\.?\s*|rupees?\s+)?([0-9][0-9,]{3,})(?!\s*%)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript))) {
    const amount = Number(m[1].replace(/,/g, ""));
    if (amount >= 1000 && amount < 100000000 && !(amount >= 1900 && amount <= 2100)) {
      out.push({ amount, context: transcript.slice(Math.max(0, m.index - 40), m.index + 30).trim() });
    }
  }
  return out;
}

function ledgerFiguresFor(loanId: string | undefined): Set<number> {
  const db = getDb();
  const figures = new Set<number>();
  const loans = loanId
    ? db.loans.filter((l) => l.loanId === loanId)
    : db.loans;
  for (const l of loans) {
    for (const n of [l.emiAmount, l.totalOutstanding, l.pendingAmount, l.principal]) figures.add(n);
    // paying two EMIs together is a common agent offer — allow small multiples
    figures.add(l.emiAmount * 2); figures.add(l.emiAmount * 3);
  }
  for (const p of db.ptps.filter((p) => !loanId || p.loanId === loanId)) figures.add(p.amount);
  for (const i of db.interactionLogs) {
    if (i.promiseToPayAmount && (!loanId || i.loanId === loanId)) figures.add(i.promiseToPayAmount);
  }
  return figures;
}

const near = (a: number, set: Set<number>) => {
  for (const f of set) if (f && Math.abs(a - f) <= f * 0.01) return true;
  return false;
};

export function scoreCall(call: {
  id: string; loanId?: string; language: string; transcript?: string; complianceGate?: unknown;
}): CallQa | null {
  const t = call.transcript;
  if (!t || t.length < 20) return null;
  const lower = t.toLowerCase();

  const checks: CallQa["checks"] = [];

  const verified = VERIFY_HINTS.some((h) => lower.includes(h.toLowerCase()));
  checks.push({ name: "identity_verification", pass: verified,
    note: verified ? "verification language present" : "no verification step found in transcript" });

  const coercive = COERCIVE.filter((w) => lower.includes(w.toLowerCase()));
  checks.push({ name: "no_coercion", pass: coercive.length === 0,
    note: coercive.length ? `coercive terms: ${coercive.join(", ")}` : "clean" });

  const gated = call.complianceGate != null;
  checks.push({ name: "gate_decision_recorded", pass: gated,
    note: gated ? "gate decision stored with call" : "no gate decision on record" });

  const figures = ledgerFiguresFor(call.loanId);
  const flags = spokenAmounts(t).filter((s) => !near(s.amount, figures));
  checks.push({ name: "ledger_figures_only", pass: flags.length === 0,
    note: flags.length ? `${flags.length} spoken amount(s) not in ledger` : "all spoken figures ledger-backed" });

  const passed = checks.filter((c) => c.pass).length;
  return {
    callId: call.id, loanId: call.loanId, language: call.language,
    score: Math.round((passed / checks.length) * 100),
    checks, hallucinationFlags: flags,
  };
}

/** Book-level QA rollup over recorded calls (seeded history + live). */
export function qaSummary(limit = 200) {
  const calls = getDb().voiceCalls.filter((v) => v.transcript).slice(-limit);
  const scored = calls.map(scoreCall).filter((s): s is CallQa => s !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;
  const flagged = scored.filter((s) => s.hallucinationFlags.length > 0);
  const failing = scored.filter((s) => s.score < 75).sort((a, b) => a.score - b.score);
  return {
    callsScored: scored.length,
    avgScore: avg,
    hallucinationFlagged: flagged.length,
    checkFailRates: ["identity_verification", "no_coercion", "gate_decision_recorded", "ledger_figures_only"]
      .map((name) => ({
        check: name,
        failPct: scored.length
          ? Math.round((scored.filter((s) => !s.checks.find((c) => c.name === name)?.pass).length / scored.length) * 100)
          : 0,
      })),
    worst: failing.slice(0, 10).map((s) => ({
      callId: s.callId, loanId: s.loanId, score: s.score,
      failed: s.checks.filter((c) => !c.pass).map((c) => c.name),
      flags: s.hallucinationFlags.slice(0, 3),
    })),
  };
}
