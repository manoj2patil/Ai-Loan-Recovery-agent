// src/lib/portfolio.ts — Phase 1: loan portfolio + NPA/delinquency engine.
// Classification per RBI IRAC: STANDARD (<NPA threshold), SUB_STANDARD (NPA ≤ 12 months),
// DOUBTFUL (NPA > 12 months), LOSS (identified loss assets — preserved from CBS).

import { listLoans, updateLoan, listCustomers, logInteraction } from "./db";
import { cfg } from "./config";
import { bucketFor } from "./business-rules";
import { Loan } from "./store";

export function classify(loan: Loan, now = new Date()): string {
  if (loan.assetClassification === "LOSS") return "LOSS"; // written-down status is sticky
  if (loan.dpd < cfg.npaDpdThreshold()) return "STANDARD";
  const npaSince = loan.npaSinceDate ? new Date(loan.npaSinceDate) : now;
  const monthsNpa = (now.getTime() - npaSince.getTime()) / (30.44 * 86400000);
  return monthsNpa > 12 ? "DOUBTFUL" : "SUB_STANDARD";
}

/** Recompute classifications across the book (the NpaRun). Returns the run summary. */
export function runNpaEngine() {
  const started = new Date();
  let processed = 0, newNpa = 0, changed = 0;
  for (const loan of listLoans()) {
    processed++;
    const next = classify(loan, started);
    if (next !== loan.assetClassification) {
      changed++;
      if (loan.assetClassification === "STANDARD") {
        newNpa++;
        if (!loan.npaSinceDate) updateLoan(loan.id, { npaSinceDate: started.toISOString() });
      }
      updateLoan(loan.id, { assetClassification: next });
      logInteraction({
        customerId: loan.customerId, loanId: loan.loanId, channel: "SYSTEM",
        direction: "INTERNAL", outcome: "NPA_RECLASSIFIED",
        details: { from: loan.assetClassification, to: next, dpd: loan.dpd },
      });
    }
  }
  return {
    startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
    loansProcessed: processed, reclassified: changed, newNpaCount: newNpa, status: "COMPLETED",
  };
}

export function portfolioStats() {
  const loans = listLoans();
  const customers = listCustomers();
  const overdue = loans.filter((l) => l.dpd > 0);
  const byBucket: Record<string, { count: number; outstanding: number }> = {};
  const byClass: Record<string, { count: number; outstanding: number }> = {};
  const byProduct: Record<string, number> = {};
  for (const l of loans) {
    if (l.dpd > 0) {
      const b = (byBucket[bucketFor(l.dpd)] ||= { count: 0, outstanding: 0 });
      b.count++; b.outstanding += l.totalOutstanding;
    }
    const c = (byClass[l.assetClassification] ||= { count: 0, outstanding: 0 });
    c.count++; c.outstanding += l.totalOutstanding;
    byProduct[l.productType] = (byProduct[l.productType] ?? 0) + 1;
  }
  const npaOutstanding = loans
    .filter((l) => l.assetClassification !== "STANDARD")
    .reduce((s, l) => s + l.totalOutstanding, 0);
  const totalOutstanding = loans.reduce((s, l) => s + l.totalOutstanding, 0);
  return {
    customers: customers.length,
    loans: loans.length,
    overdueLoans: overdue.length,
    totalOutstanding,
    npaOutstanding,
    grossNpaPct: totalOutstanding ? Math.round((npaOutstanding / totalOutstanding) * 1000) / 10 : 0,
    byBucket, byClass, byProduct,
  };
}
