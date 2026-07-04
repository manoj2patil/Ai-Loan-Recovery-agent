// GET /api/network — the guarantor network graph (the moat feature): borrower↔guarantor
// edges, plus the actionable overlaps — guarantors who are themselves borrowers, and
// guarantors backing multiple loans. PII masked.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { maskName } from "@/lib/audit";

export async function GET() {
  const db = getDb();
  const loanById = new Map(db.loans.map((l) => [l.id, l]));
  const customerById = new Map(db.customers.map((c) => [c.id, c]));

  const edges = db.guarantors.flatMap((g) => {
    const loan = loanById.get(g.linkedLoanId);
    if (!loan) return [];
    const borrower = customerById.get(loan.customerId);
    return [{
      guarantorId: g.guarantorId, guarantor: maskName(g.name), relationship: g.relationship,
      loanId: loan.loanId, dpd: loan.dpd,
      borrower: borrower ? maskName(borrower.name) : "—",
      guarantorIsCustomer: !!g.customerId,
      escalationStatus: g.escalationStatus,
    }];
  });

  // Guarantors backing more than one loan (concentration risk / leverage point)
  const byPhone: Record<string, number> = {};
  for (const g of db.guarantors) byPhone[g.phone] = (byPhone[g.phone] ?? 0) + 1;
  const multiLoan = db.guarantors
    .filter((g) => byPhone[g.phone] > 1)
    .map((g) => ({ guarantorId: g.guarantorId, name: maskName(g.name), loans: byPhone[g.phone] }));

  // Guarantors who are themselves borrowers with overdue loans (highest-leverage contacts)
  const crossExposed = db.guarantors
    .filter((g) => g.customerId)
    .map((g) => {
      const own = db.loans.filter((l) => l.customerId === g.customerId && l.dpd > 0);
      return own.length
        ? { guarantorId: g.guarantorId, name: maskName(g.name), ownOverdueLoans: own.length, maxOwnDpd: Math.max(...own.map((l) => l.dpd)) }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({
    nodes: { borrowers: db.customers.length, guarantors: db.guarantors.length },
    edges,
    insights: { multiLoanGuarantors: multiLoan, crossExposedGuarantors: crossExposed },
  });
}
