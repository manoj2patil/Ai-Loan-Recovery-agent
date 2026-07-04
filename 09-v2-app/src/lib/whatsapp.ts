// src/lib/whatsapp.ts — gated WhatsApp notices (BUILD_STEPS Step 9). Picks the notice
// template by DPD bucket, renders it in the borrower's language (hi/en fallback), runs the
// Compliance Gate, "sends" via the BSP, and logs WhatsappMessage + InteractionLog.
// DEV: the BSP call is simulated (status DELIVERED). PRODUCTION: post to the WhatsApp
// Business API (Utility templates only) using WABA_* from SystemConfig.

import { findLoanByLoanId, findTemplate, insertWhatsappMessage, logInteraction } from "./db";
import { evaluateGate } from "./compliance";
import { bucketFor } from "./business-rules";
import { maskName } from "./audit";

const BUCKET_TEMPLATE: Record<string, string> = {
  "0-30": "emi_due_reminder",
  "31-60": "overdue_notice",
  "61-90": "overdue_notice",
  "91-180": "npa_classification_notice",
  "180+": "npa_classification_notice",
};

function render(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d)\}\}/g, (_, n) => vars[Number(n) - 1] ?? "");
}

/** Send the DPD-appropriate notice for a loan (or an explicit templateName). */
export async function sendNotice(loanId: string, templateName?: string) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const customer = loan.customer;

  const name = templateName ?? BUCKET_TEMPLATE[bucketFor(loan.dpd)];
  const template = findTemplate(name, customer.preferredLanguage);
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

  // PRODUCTION: POST to the WABA endpoint here; use the returned wamid + delivery webhooks.
  const message = insertWhatsappMessage({
    customerId: customer.id, loanId: loan.loanId, templateId: template.id,
    direction: "OUTBOUND", toPhone: customer.phone, body, status: "DELIVERED",
    variables: { customer_name: maskName(customer.name), loan_id: loan.loanId },
    sentAt: new Date().toISOString(), deliveredAt: new Date().toISOString(),
  });
  logInteraction({
    customerId: customer.id, loanId: loan.loanId, channel: "WHATSAPP",
    direction: "OUTBOUND", outcome: "NOTICE_SENT", gateVerdict: gate.verdict,
    details: { template: template.templateName, language: template.language, messageId: message.id },
  });
  return { sent: true, gate, messageId: message.id, template: template.templateName, body };
}
