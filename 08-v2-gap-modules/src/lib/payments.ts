// src/lib/payments.ts — Payments closure module (Phase 3 ★, highest-ROI gap).
// Secure payment links per loan, webhook reconciliation, auto-suppression on payment, receipts.
// Matches the app's existing pattern (Prisma + src/lib). Wire `prisma` to your client.

import crypto from "crypto";
// import { prisma } from "./db";
// import { evaluateGate } from "./compliance";

export type PaymentStatus = "CREATED" | "PAID" | "EXPIRED" | "FAILED" | "UNMATCHED";

export interface PaymentLink {
  id: string;            // plink_<random>
  loanId: string;
  customerId: string;
  amount: number;        // from ledger (pendingAmount or agreed PTP amount) — never LLM-generated
  purpose: "EMI" | "PTP" | "SETTLEMENT" | "PARTIAL";
  upiDeepLink: string;   // upi://pay?...  (or PG checkout URL)
  webUrl: string;        // hosted checkout / self-service page
  expiresAt: Date;
  status: PaymentStatus;
  signature: string;     // HMAC so links can't be tampered
}

const SECRET = process.env.PAYMENT_LINK_SECRET || "change-me";

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 16);
}

/** Create a payment link for a loan. Amount MUST come from the ledger/PTP record. */
export async function createPaymentLink(opts: {
  loanId: string; customerId: string; amount: number;
  purpose: PaymentLink["purpose"]; vpa?: string; payeeName?: string;
}): Promise<PaymentLink> {
  const id = "plink_" + crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 3600 * 1000); // 72h validity
  const vpa = opts.vpa || process.env.BANK_VPA || "skvcb@upi";
  const payee = encodeURIComponent(opts.payeeName || process.env.BANK_NAME || "SKVCB");
  const note = encodeURIComponent(`${opts.purpose} ${opts.loanId}`);
  const upiDeepLink =
    `upi://pay?pa=${vpa}&pn=${payee}&am=${opts.amount.toFixed(2)}&cu=INR&tn=${note}&tr=${id}`;
  const signature = sign(`${id}|${opts.loanId}|${opts.amount}`);
  const webUrl = `${process.env.APP_URL || ""}/pay/${id}?sig=${signature}`;

  const link: PaymentLink = {
    id, loanId: opts.loanId, customerId: opts.customerId, amount: opts.amount,
    purpose: opts.purpose, upiDeepLink, webUrl, expiresAt, status: "CREATED", signature,
  };
  // await prisma.paymentLink.create({ data: link });
  return link;
}

/** Verify a link signature (for the /pay page). */
export function verifyLink(id: string, loanId: string, amount: number, sig: string): boolean {
  return sign(`${id}|${loanId}|${amount}`) === sig;
}

/** PG/UPI webhook → reconcile, suppress outreach, close PTP, issue receipt. Idempotent. */
export async function handlePaymentWebhook(evt: {
  reference: string;        // our plink id (tr=) or UTR
  amountPaid: number;
  utr?: string;
  paidAt: string;
}): Promise<{ matched: boolean; action: string }> {
  // const link = await prisma.paymentLink.findUnique({ where: { id: evt.reference } });
  const link: PaymentLink | null = null as any; // wire to DB

  if (!link) {
    // Unmatched payment queue — a human reconciles (partial UTRs, manual NEFT, etc.)
    // await prisma.unmatchedPayment.create({ data: { ...evt } });
    return { matched: false, action: "queued_unmatched" };
  }
  if (link.status === "PAID") return { matched: true, action: "duplicate_ignored" }; // idempotent

  // 1) mark paid
  // await prisma.paymentLink.update({ where: { id: link.id }, data: { status: "PAID" } });
  // 2) IMMEDIATE suppression — never dun someone who just paid (compliance + reputation)
  // await prisma.suppression.create({ data: { customerId: link.customerId, reason: "paid",
  //   active: true, endsAt: addDays(new Date(), 2) } });
  // 3) close matching PTP as KEPT if amounts align (tolerance ±1%)
  // 4) InteractionLog: PAYMENT_RECEIVED with utr + amount
  // 5) receipt: WhatsApp Utility template "payment_confirmation" via gated send
  // 6) emit orchestrator event payment.received (cancels queued outreach)
  return { matched: true, action: "reconciled_suppressed_receipted" };
}

/** On-call payment: agent tool generates a link mid-call; confirmation read back to borrower. */
export async function onCallPaymentLink(loanId: string, customerId: string, amount: number) {
  const link = await createPaymentLink({ loanId, customerId, amount, purpose: "PTP" });
  // SMS/WhatsApp the webUrl immediately (gated); return short confirmation text for TTS.
  return { link, speech: `I've sent a secure payment link to your registered number. It is valid for three days.` };
}
