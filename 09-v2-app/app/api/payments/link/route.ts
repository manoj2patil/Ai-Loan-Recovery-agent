// POST /api/payments/link — create a secure payment link for a loan.
// Body: { loanId, purpose: "EMI"|"PTP"|"SETTLEMENT"|"PARTIAL", amount? }
// Ledger-only amount rule: the client may pass an amount ONLY for SETTLEMENT/PARTIAL,
// capped at total outstanding; EMI/PTP amounts always come from the ledger.

import { NextResponse } from "next/server";
import { createPaymentLink, findLoanByLoanId } from "@/lib/payments";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "officer");
    const { loanId, purpose, amount } = await req.json();

    if (!["EMI", "PTP", "SETTLEMENT", "PARTIAL"].includes(purpose))
      return NextResponse.json({ error: "invalid purpose" }, { status: 400 });

    const loan = findLoanByLoanId(loanId);
    if (!loan) return NextResponse.json({ error: "loan not found" }, { status: 404 });

    const amt = ["SETTLEMENT", "PARTIAL"].includes(purpose)
      ? Math.min(Number(amount || 0), loan.totalOutstanding)
      : purpose === "EMI" ? loan.emiAmount : loan.pendingAmount;
    if (!amt || amt <= 0) return NextResponse.json({ error: "amount required" }, { status: 400 });

    const link = await createPaymentLink({
      loanId, customerId: loan.customer.id, amount: amt, purpose,
    });

    writeAudit({
      actor: actor.name, role: actor.role, action: "PAYMENT_LINK_CREATE",
      entity: "PaymentLink", entityId: link.id, details: { loanId, purpose, amount: amt },
    });

    return NextResponse.json({
      ok: true,
      link: { id: link.id, webUrl: link.webUrl, upi: link.upiDeepLink, amount: amt, expiresAt: link.expiresAt },
    });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
