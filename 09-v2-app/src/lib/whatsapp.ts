// src/lib/whatsapp.ts — gated WhatsApp notices (BUILD_STEPS Step 9). Picks the notice
// template by DPD bucket, renders it in the borrower's language (hi/en fallback), runs the
// Compliance Gate, "sends" via the BSP, and logs WhatsappMessage + InteractionLog.
// DEV: the BSP call is simulated (status DELIVERED). PRODUCTION: post to the WhatsApp
// Business API (Utility templates only) using WABA_* from SystemConfig.

import { findLoanByLoanId, findTemplate, insertWhatsappMessage, logInteraction } from "./db";
import { evaluateGate } from "./compliance";
import { bucketFor } from "./business-rules";
import { maskName } from "./audit";
import { createPaymentLink } from "./payments";
import { waLabels } from "./language";
import { getConfig } from "./config";

// Template names as they exist in the seeded WhatsappTemplate registry (from the CBS export).
const BUCKET_TEMPLATE: Record<string, string> = {
  "0-30": "emi_due_reminder",
  "31-60": "emi_overdue_notice",
  "61-90": "emi_overdue_notice",
  "91-180": "npa_warning_notice",
  "180+": "npa_warning_notice",
};

function render(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d)\}\}/g, (_, n) => vars[Number(n) - 1] ?? "");
}

/** Shared dispatch: real Twilio WhatsApp send when configured (pilot-allowlist guarded),
 *  else simulated. Returns wamid + status. Throws on provider rejection / egress block. */
async function dispatchWhatsapp(toPhone: string, body: string): Promise<{ wamid?: string; status: "SENT" | "DELIVERED" }> {
  if (!(process.env.TWILIO_WHATSAPP_FROM && process.env.TWILIO_ACCOUNT_SID)) {
    return { status: "DELIVERED" }; // dev / simulated BSP
  }
  const allowlist = (process.env.OUTBOUND_CALL_ALLOWLIST ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(toPhone))
    throw new Error("destination not in OUTBOUND_CALL_ALLOWLIST (pilot safety)");
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, To: `whatsapp:${toPhone}`, Body: body }).toString(),
  });
  const text = await res.text();
  let parsed: { sid?: string; message?: string };
  try { parsed = JSON.parse(text); } catch {
    throw new Error(`WhatsApp dispatch blocked before reaching Twilio (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`Twilio WhatsApp ${res.status}: ${parsed.message ?? "send failed"}`);
  return { wamid: parsed.sid, status: "SENT" };
}

/** Rich payment message (the agent's close-of-call deliverable): full account details +
 *  secure payment link + UPI-reference instructions, localized to the borrower's language.
 *  ALL figures come from the ledger (GOLDEN RULE 1). Sent through the gate (intent="receipt":
 *  transactional, the borrower agreed on the call). Returns the payment link + rendered body. */
export async function sendPaymentMessage(loanId: string, opts?: { amount?: number; payByDate?: string; language?: string }) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const customer = loan.customer;
  const lang = opts?.language ?? customer.preferredLanguage;
  const L = waLabels(lang);

  const amount = opts?.amount ?? loan.emiAmount; // EMI by default — ledger-derived
  const link = await createPaymentLink({ loanId, customerId: customer.id, amount, purpose: "EMI" });

  const gate = await evaluateGate({ customerId: customer.id, channel: "whatsapp", intent: "receipt" });
  if (gate.verdict !== "ALLOW") return { sent: false, gate };

  const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
  const payBy = opts?.payByDate
    ?? new Date(Date.now() + 2 * 86400000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const nextDue = loan.nextDueDate ? new Date(loan.nextDueDate).toISOString().slice(0, 10) : "—";
  const agent = getConfig("AGENT_NAME", process.env.AGENT_NAME || "Asha");
  const bank = getConfig("BANK_NAME", "Sahakar Krishi Vikas Cooperative Bank (SKVCB)");

  const body = [
    L.greet(customer.name),
    L.accountDetails,
    `${L.acctNo}: ${loan.loanId}`,
    `${L.pending}: ${inr(loan.pendingAmount)}`,
    `${L.emi}: ${inr(loan.emiAmount)}`,
    L.daysOverdue(loan.dpd, bucketFor(loan.dpd)),
    `${L.nextDue}: ${nextDue}`,
    L.payBy(payBy),
    L.payHere,
    link.webUrl,
    L.ifPaid,
    L.confirmDate,
    L.stop,
    `— ${agent}, ${bank}`,
  ].join("\n");

  const { wamid, status } = await dispatchWhatsapp(customer.phone, body);
  const message = insertWhatsappMessage({
    customerId: customer.id, loanId: loan.loanId, direction: "OUTBOUND", toPhone: customer.phone,
    body, status, variables: { loan_id: loan.loanId, linkId: link.id, ...(wamid ? { wamid } : {}) },
    sentAt: new Date().toISOString(), deliveredAt: status === "DELIVERED" ? new Date().toISOString() : undefined,
  });
  logInteraction({
    customerId: customer.id, loanId: loan.loanId, channel: "WHATSAPP", direction: "OUTBOUND",
    outcome: "PAYMENT_LINK_SENT", gateVerdict: gate.verdict,
    details: { messageId: message.id, linkId: link.id, amount, language: lang },
  });
  return { sent: true, gate, messageId: message.id, link: link.webUrl, body };
}

/** Send the DPD-appropriate notice for a loan (or an explicit templateName). */
export async function sendNotice(loanId: string, templateName?: string) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const customer = loan.customer;

  const name = templateName ?? BUCKET_TEMPLATE[bucketFor(loan.dpd)];
  // Language variants are suffixed in the registry (emi_due_reminder_en/_ta/_te) —
  // try the borrower-language variant first, then the base name, then the EMI fallback.
  const template =
    findTemplate(`${name}_${customer.preferredLanguage}`, customer.preferredLanguage)
    ?? findTemplate(name, customer.preferredLanguage)
    ?? findTemplate("emi_due_reminder", customer.preferredLanguage);
  if (!template) throw new Error(`no approved template '${name}'`);

  const gate = await evaluateGate({ customerId: customer.id, channel: "whatsapp", intent: "recovery" });
  if (gate.verdict !== "ALLOW") return { sent: false, gate };

  // Ledger-only figures — variables come from the loan record, never generated.
  const vars = [
    customer.name, loan.loanId,
    `₹${loan.emiAmount.toLocaleString("en-IN")}`,
    loan.nextDueDate ? new Date(loan.nextDueDate).toLocaleDateString("en-IN") : "immediately",
  ];
  const body = render(template.bodyText, vars);

  const { wamid, status } = await dispatchWhatsapp(customer.phone, body);

  const message = insertWhatsappMessage({
    customerId: customer.id, loanId: loan.loanId, templateId: template.id,
    direction: "OUTBOUND", toPhone: customer.phone, body, status,
    variables: { customer_name: maskName(customer.name), loan_id: loan.loanId, ...(wamid ? { wamid } : {}) },
    sentAt: new Date().toISOString(), deliveredAt: status === "DELIVERED" ? new Date().toISOString() : undefined,
  });
  logInteraction({
    customerId: customer.id, loanId: loan.loanId, channel: "WHATSAPP",
    direction: "OUTBOUND", outcome: "NOTICE_SENT", gateVerdict: gate.verdict,
    details: { template: template.templateName, language: template.language, messageId: message.id },
  });
  return { sent: true, gate, messageId: message.id, template: template.templateName, body };
}
