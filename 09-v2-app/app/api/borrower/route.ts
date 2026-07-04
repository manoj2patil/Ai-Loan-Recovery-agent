// GET /api/borrower?loanId=LN500001 — the Borrower-360 view: masked profile, ledger facts,
// explainable propensity, settlement recommendation, best-time/channel, guarantors,
// recent interactions. Figures are ledger-only (GOLDEN RULE 1) and PII is masked.

import { NextResponse } from "next/server";
import { findLoanByLoanId, guarantorsForLoan, voiceHistory, whatsappHistory } from "@/lib/db";
import { getDb } from "@/lib/store";
import { propensityScore, settlementRecommendation, bestTimeChannel } from "@/lib/propensity";
import { maskName, maskPhone } from "@/lib/audit";

export async function GET(req: Request) {
  const loanId = new URL(req.url).searchParams.get("loanId") ?? "";
  const loan = findLoanByLoanId(loanId);
  if (!loan) return NextResponse.json({ error: "loan not found" }, { status: 404 });
  const c = loan.customer;

  const interactions = getDb().interactionLogs
    .filter((i) => i.customerId === c.id)
    .slice(-15).reverse();

  return NextResponse.json({
    borrower: {
      name: maskName(c.name), customerId: c.customerId, phone: maskPhone(c.phone),
      language: c.preferredLanguage,
      consent: { voice: c.consentVoice.granted, whatsapp: c.consentWhatsapp.granted, sms: c.consentSms.granted },
    },
    loan: {
      loanId: loan.loanId, product: loan.productType, principal: loan.principal,
      emi: loan.emiAmount, outstanding: loan.totalOutstanding, pending: loan.pendingAmount,
      dpd: loan.dpd, classification: loan.assetClassification,
      nextDueDate: loan.nextDueDate, sarfaesiNoticeDate: loan.sarfaesiNoticeDate,
    },
    guarantors: guarantorsForLoan(loan.id).map((g) => ({
      guarantorId: g.guarantorId, name: maskName(g.name), phone: maskPhone(g.phone),
      relationship: g.relationship, escalationStatus: g.escalationStatus,
      consent: { voice: g.consentVoice.granted, whatsapp: g.consentWhatsapp.granted },
    })),
    intelligence: {
      propensity: propensityScore(loanId),
      settlement: settlementRecommendation(loanId),
      bestContact: bestTimeChannel(loanId),
    },
    history: {
      calls: voiceHistory(c.id).length,
      messages: whatsappHistory(c.id).length,
      recent: interactions.map((i) => ({
        at: i.createdAt, channel: i.channel, direction: i.direction,
        outcome: i.outcome, gate: i.gateVerdict,
      })),
    },
  });
}
