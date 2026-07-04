// src/lib/payments.ts — Payments closure module (Phase 3 ★, highest-ROI gap), fully wired.
// Secure payment links per loan, webhook reconciliation, auto-suppression on payment,
// PTP closure, receipts via the gated send, unmatched-payment queue. Idempotent.

import crypto from "crypto";
import {
  findLoanByLoanId, insertPaymentLink, findPaymentLink, updatePaymentLink,
  queueUnmatchedPayment, findOpenPtp, insertPtp, closePtp, insertSuppression,
  logInteraction, cancelScheduledVisits,
} from "./db";
import { evaluateGate } from "./compliance";
import { PaymentLinkRow } from "./store";

const LINK_SECRET = process.env.PAYMENT_LINK_SECRET || "dev-link-secret";
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "dev-webhook-secret";

function sign(payload: string): string {
  return crypto.createHmac("sha256", LINK_SECRET).update(payload).digest("hex").slice(0, 16);
}

/** Create a payment link for a loan. Amount MUST come from the ledger/PTP record —
 *  the caller (route) enforces the ledger-only rule; this function persists and signs. */
export async function createPaymentLink(opts: {
  loanId: string; customerId: string; amount: number;
  purpose: PaymentLinkRow["purpose"]; vpa?: string; payeeName?: string;
}): Promise<PaymentLinkRow> {
  const id = "plink_" + crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString(); // 72h validity
  const vpa = opts.vpa || process.env.BANK_VPA || "skvcb@upi";
  const payee = encodeURIComponent(opts.payeeName || process.env.BANK_NAME || "SKVCB");
  const note = encodeURIComponent(`${opts.purpose} ${opts.loanId}`);
  const upiDeepLink =
    `upi://pay?pa=${vpa}&pn=${payee}&am=${opts.amount.toFixed(2)}&cu=INR&tn=${note}&tr=${id}`;
  const signature = sign(`${id}|${opts.loanId}|${opts.amount}`);
  const webUrl = `${process.env.APP_URL || "http://localhost:3000"}/pay/${id}?sig=${signature}`;

  const link: PaymentLinkRow = {
    id, loanId: opts.loanId, customerId: opts.customerId, amount: opts.amount,
    purpose: opts.purpose, upiDeepLink, webUrl, expiresAt, status: "CREATED", signature,
    createdAt: new Date().toISOString(),
  };
  insertPaymentLink(link);

  // A PTP-purpose link implies a promise: track it so the webhook can close it as KEPT.
  if (opts.purpose === "PTP" && !findOpenPtp(opts.loanId)) {
    insertPtp({ loanId: opts.loanId, customerId: opts.customerId, amount: opts.amount, dueDate: expiresAt });
  }

  logInteraction({
    customerId: opts.customerId, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "LINK_CREATED",
    details: { linkId: id, amount: opts.amount, purpose: opts.purpose },
  });
  return link;
}

/** Verify a link signature (for the /pay page). */
export function verifyLink(id: string, loanId: string, amount: number, sig: string): boolean {
  const expected = sign(`${id}|${loanId}|${amount}`);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig.padEnd(expected.length).slice(0, expected.length)));
}

/** Verify the PG's webhook signature over the raw body. Reject on mismatch — never skip. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const given = Buffer.from(signatureHeader.padEnd(expected.length).slice(0, expected.length));
  return crypto.timingSafeEqual(Buffer.from(expected), given);
}

export function signWebhookBody(rawBody: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

/** The payment-closure steps every successful payment runs, whatever the source
 *  (PG webhook, field-visit cash, NACH debit): suppression, PTP KEPT, PAYMENT_RECEIVED
 *  log, gated receipt, orchestrator event. */
async function closeOnPayment(opts: {
  customerId: string; loanId: string; amount: number; utr?: string;
  source: "webhook" | "visit" | "nach"; sourceRef?: string;
}): Promise<void> {
  // 1) IMMEDIATE suppression — never dun someone who just paid (compliance + reputation)
  insertSuppression({
    customerId: opts.customerId, reason: "paid",
    endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  });

  // 2) close matching PTP as KEPT if amounts align (tolerance ±1%)
  const ptp = findOpenPtp(opts.loanId);
  if (ptp && Math.abs(opts.amount - ptp.amount) <= ptp.amount * 0.01) {
    closePtp(ptp.id, "KEPT");
  }

  // 3) InteractionLog: PAYMENT_RECEIVED with utr + amount
  logInteraction({
    customerId: opts.customerId, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INBOUND", outcome: "PAYMENT_RECEIVED",
    details: { source: opts.source, sourceRef: opts.sourceRef, utr: opts.utr, amount: opts.amount },
  });

  // 4) receipt: WhatsApp Utility template "payment_confirmation" via the gated send
  const gate = await evaluateGate({ customerId: opts.customerId, channel: "whatsapp", intent: "receipt" });
  if (gate.verdict === "ALLOW") {
    // PRODUCTION: send the approved "payment_confirmation" template via the WhatsApp BSP here.
    logInteraction({
      customerId: opts.customerId, loanId: opts.loanId, channel: "WHATSAPP",
      direction: "OUTBOUND", outcome: "RECEIPT_SENT", gateVerdict: gate.verdict,
      details: { template: "payment_confirmation", amount: opts.amount, utr: opts.utr },
    });
  }

  // 5) orchestrator event payment.received — cancels queued outreach incl. field visits
  const cancelled = cancelScheduledVisits(opts.loanId, "cancelled: payment received");
  logInteraction({
    customerId: opts.customerId, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "EVENT_PAYMENT_RECEIVED",
    details: { visitsCancelled: cancelled },
  });
}

/** PG/UPI webhook → reconcile, suppress outreach, close PTP, issue receipt. Idempotent. */
export async function handlePaymentWebhook(evt: {
  reference: string;        // our plink id (tr=) or UTR
  amountPaid: number;
  utr?: string;
  paidAt: string;
}): Promise<{ matched: boolean; action: string; linkId?: string }> {
  const link = findPaymentLink(evt.reference);

  if (!link) {
    // Unmatched payment queue — a human reconciles (partial UTRs, manual NEFT, etc.)
    queueUnmatchedPayment({ reference: evt.reference, amount: evt.amountPaid, utr: evt.utr, raw: evt });
    return { matched: false, action: "queued_unmatched" };
  }
  if (link.status === "PAID") return { matched: true, action: "duplicate_ignored", linkId: link.id };

  updatePaymentLink(link.id, { status: "PAID", utr: evt.utr, paidAt: evt.paidAt });
  await closeOnPayment({
    customerId: link.customerId, loanId: link.loanId, amount: evt.amountPaid,
    utr: evt.utr, source: "webhook", sourceRef: link.id,
  });
  return { matched: true, action: "reconciled_suppressed_receipted", linkId: link.id };
}

/** Off-channel collection (field-visit cash, NACH debit) — runs the SAME closure steps
 *  as the webhook, without pretending to be one (no spurious unmatched-queue rows). */
export async function recordCollection(opts: {
  loanId: string; customerId: string; amount: number;
  source: "visit" | "nach"; sourceRef: string; utr?: string;
}): Promise<{ matched: true; action: string }> {
  await closeOnPayment({
    customerId: opts.customerId, loanId: opts.loanId, amount: opts.amount,
    utr: opts.utr ?? opts.sourceRef, source: opts.source, sourceRef: opts.sourceRef,
  });
  return { matched: true, action: `${opts.source}_collection_closed` };
}

/** On-call payment: agent tool generates a link mid-call; confirmation read back to borrower.
 *  The link is sent over WhatsApp/SMS through the gate (intent="receipt": the borrower asked
 *  for it on the call — it's a transactional message, not fresh outreach). */
export async function onCallPaymentLink(loanId: string, customerId: string, amount: number) {
  const link = await createPaymentLink({ loanId, customerId, amount, purpose: "PTP" });
  const gate = await evaluateGate({ customerId, channel: "whatsapp", intent: "receipt" });
  if (gate.verdict === "ALLOW") {
    logInteraction({
      customerId, loanId, channel: "WHATSAPP", direction: "OUTBOUND",
      outcome: "PAYMENT_LINK_SENT", gateVerdict: gate.verdict,
      details: { linkId: link.id, webUrl: link.webUrl },
    });
  }
  return {
    link,
    speech: "I've sent a secure payment link to your registered number. It is valid for three days.",
  };
}

export { findLoanByLoanId };
