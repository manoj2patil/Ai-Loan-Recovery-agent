// src/lib/db.ts — data access for the v2 modules. Every function here maps 1:1 onto a
// Prisma call against the models in prisma/schema.prisma; swap the store import for the
// Prisma client when moving to PostgreSQL.

import {
  getDb, persist, newId,
  Customer, Loan, PaymentLinkRow, Ptp, Suppression, InteractionLog,
  LegalCaseRow, LegalCaseHistoryRow, FieldVisitRow, UnmatchedPayment, NachMandate,
  Guarantor, WhatsappTemplateRow, WhatsappMessageRow, VoiceCallRow, BusinessRule,
} from "./store";

// ---- lookups ----
export function findLoanByLoanId(loanId: string): (Loan & { customer: Customer }) | null {
  const db = getDb();
  const loan = db.loans.find((l) => l.loanId === loanId);
  if (!loan) return null;
  // SCHEMA.md: Loan.customerId → Customer.id (internal cuid), NOT Customer.customerId
  const customer = db.customers.find((c) => c.id === loan.customerId);
  return customer ? { ...loan, customer } : null;
}

export function findCustomerById(id: string): Customer | null {
  return getDb().customers.find((c) => c.id === id || c.customerId === id) ?? null;
}

// ---- payment links ----
export function insertPaymentLink(row: PaymentLinkRow): void {
  getDb().paymentLinks.push(row); persist();
}
export function findPaymentLink(ref: string): PaymentLinkRow | null {
  return getDb().paymentLinks.find((p) => p.id === ref || (p.utr && p.utr === ref)) ?? null;
}
export function updatePaymentLink(id: string, patch: Partial<PaymentLinkRow>): void {
  const db = getDb();
  const i = db.paymentLinks.findIndex((p) => p.id === id);
  if (i >= 0) { db.paymentLinks[i] = { ...db.paymentLinks[i], ...patch }; persist(); }
}
export function queueUnmatchedPayment(u: Omit<UnmatchedPayment, "id" | "createdAt">): UnmatchedPayment {
  const row = { ...u, id: newId("unm"), createdAt: new Date().toISOString() };
  getDb().unmatchedPayments.push(row); persist();
  return row;
}

// ---- PTP lifecycle ----
export function findOpenPtp(loanId: string): Ptp | null {
  return getDb().ptps.find((p) => p.loanId === loanId && p.status === "OPEN") ?? null;
}
export function insertPtp(p: Omit<Ptp, "id" | "createdAt" | "status">): Ptp {
  const row: Ptp = { ...p, id: newId("ptp"), status: "OPEN", createdAt: new Date().toISOString() };
  getDb().ptps.push(row); persist();
  return row;
}
export function closePtp(id: string, status: "KEPT" | "BROKEN" | "CANCELLED"): void {
  const db = getDb();
  const p = db.ptps.find((x) => x.id === id);
  if (p) { p.status = status; p.closedAt = new Date().toISOString(); persist(); }
}

// ---- suppression ----
export function insertSuppression(s: Omit<Suppression, "id" | "createdAt" | "active">): Suppression {
  const row: Suppression = { ...s, id: newId("sup"), active: true, createdAt: new Date().toISOString() };
  getDb().suppressions.push(row); persist();
  return row;
}
export function activeSuppressions(customerId: string): Suppression[] {
  const now = Date.now();
  return getDb().suppressions.filter(
    (s) => s.customerId === customerId && s.active && (!s.endsAt || Date.parse(s.endsAt) > now),
  );
}

// ---- interaction log ----
export function logInteraction(e: Omit<InteractionLog, "id" | "createdAt">): InteractionLog {
  const row: InteractionLog = { ...e, id: newId("il"), createdAt: new Date().toISOString() };
  getDb().interactionLogs.push(row); persist();
  return row;
}
export function recentInteractions(customerId: string, channel: InteractionLog["channel"], days: number): InteractionLog[] {
  const since = Date.now() - days * 86400000;
  return getDb().interactionLogs.filter(
    (i) => i.customerId === customerId && i.channel === channel &&
      i.direction === "OUTBOUND" && Date.parse(i.createdAt) >= since,
  );
}

// ---- legal ----
export function insertLegalCase(c: Omit<LegalCaseRow, "id" | "createdAt">): LegalCaseRow {
  const row = { ...c, id: newId("case"), createdAt: new Date().toISOString() };
  getDb().legalCases.push(row); persist();
  return row;
}
export function findLegalCase(id: string): LegalCaseRow | null {
  return getDb().legalCases.find((c) => c.id === id) ?? null;
}
export function updateLegalCase(id: string, patch: Partial<LegalCaseRow>): void {
  const db = getDb();
  const i = db.legalCases.findIndex((c) => c.id === id);
  if (i >= 0) { db.legalCases[i] = { ...db.legalCases[i], ...patch }; persist(); }
}
export function listLegalCases(): LegalCaseRow[] { return getDb().legalCases; }
export function insertCaseHistory(h: Omit<LegalCaseHistoryRow, "id" | "at">): void {
  getDb().legalCaseHistory.push({ ...h, id: newId("lh"), at: new Date().toISOString() }); persist();
}
export function caseHistory(caseId: string): LegalCaseHistoryRow[] {
  return getDb().legalCaseHistory.filter((h) => h.caseId === caseId);
}

// ---- field visits ----
export function insertFieldVisit(v: Omit<FieldVisitRow, "id">): FieldVisitRow {
  const row = { ...v, id: newId("visit") };
  getDb().fieldVisits.push(row); persist();
  return row;
}
export function findFieldVisit(id: string): FieldVisitRow | null {
  return getDb().fieldVisits.find((v) => v.id === id) ?? null;
}
export function updateFieldVisit(id: string, patch: Partial<FieldVisitRow>): void {
  const db = getDb();
  const i = db.fieldVisits.findIndex((v) => v.id === id);
  if (i >= 0) { db.fieldVisits[i] = { ...db.fieldVisits[i], ...patch }; persist(); }
}
export function listFieldVisits(): FieldVisitRow[] { return getDb().fieldVisits; }
export function cancelScheduledVisits(loanId: string, reason: string): number {
  const db = getDb();
  let n = 0;
  for (const v of db.fieldVisits) {
    if (v.loanId === loanId && v.status === "SCHEDULED") {
      v.status = "CANCELLED"; v.outcomeNote = reason; n++;
    }
  }
  if (n) persist();
  return n;
}

// ---- NACH mandates ----
export function insertNachMandate(m: Omit<NachMandate, "id" | "createdAt" | "bounceCount" | "status">): NachMandate {
  const row: NachMandate = {
    ...m, id: newId("nach"), status: "ACTIVE", bounceCount: 0, createdAt: new Date().toISOString(),
  };
  getDb().nachMandates.push(row); persist();
  return row;
}
export function findNachMandate(idOrUmrn: string): NachMandate | null {
  return getDb().nachMandates.find((m) => m.id === idOrUmrn || m.umrn === idOrUmrn) ?? null;
}
export function findMandateByLoan(loanId: string): NachMandate | null {
  return getDb().nachMandates.find((m) => m.loanId === loanId && m.status === "ACTIVE")
    ?? getDb().nachMandates.find((m) => m.loanId === loanId) ?? null;
}
export function updateNachMandate(id: string, patch: Partial<NachMandate>): void {
  const db = getDb();
  const i = db.nachMandates.findIndex((m) => m.id === id);
  if (i >= 0) { db.nachMandates[i] = { ...db.nachMandates[i], ...patch }; persist(); }
}
export function listNachMandates(): NachMandate[] { return getDb().nachMandates; }

// ---- guarantors ----
export function guarantorsForLoan(loanDbId: string): Guarantor[] {
  return getDb().guarantors.filter((g) => g.linkedLoanId === loanDbId);
}
export function updateGuarantor(id: string, patch: Partial<Guarantor>): void {
  const db = getDb();
  const i = db.guarantors.findIndex((g) => g.id === id);
  if (i >= 0) { db.guarantors[i] = { ...db.guarantors[i], ...patch }; persist(); }
}

// ---- WhatsApp ----
export function findTemplate(name: string, language: string): WhatsappTemplateRow | null {
  const all = getDb().whatsappTemplates.filter((t) => t.templateName === name && t.status === "APPROVED");
  return all.find((t) => t.language === language) ?? all.find((t) => t.language === "hi")
    ?? all.find((t) => t.language === "en") ?? all[0] ?? null;
}
export function listTemplates(): WhatsappTemplateRow[] { return getDb().whatsappTemplates; }
export function insertWhatsappMessage(m: Omit<WhatsappMessageRow, "id">): WhatsappMessageRow {
  const row = { ...m, id: newId("wam") };
  getDb().whatsappMessages.push(row); persist();
  return row;
}
export function whatsappHistory(customerId: string): WhatsappMessageRow[] {
  return getDb().whatsappMessages.filter((m) => m.customerId === customerId);
}

// ---- voice calls ----
export function insertVoiceCall(v: Omit<VoiceCallRow, "id">): VoiceCallRow {
  const row = { ...v, id: newId("vc") };
  getDb().voiceCalls.push(row); persist();
  return row;
}
export function voiceHistory(customerId: string): VoiceCallRow[] {
  return getDb().voiceCalls.filter((v) => v.customerId === customerId);
}

// ---- business rules ----
export function listBusinessRules(): BusinessRule[] { return getDb().businessRules; }
export function saveBusinessRules(rules: BusinessRule[]): void {
  getDb().businessRules = rules; persist();
}
export function updateBusinessRule(id: string, patch: Partial<BusinessRule>): BusinessRule | null {
  const db = getDb();
  const i = db.businessRules.findIndex((r) => r.id === id);
  if (i < 0) return null;
  db.businessRules[i] = { ...db.businessRules[i], ...patch }; persist();
  return db.businessRules[i];
}

// ---- callbacks (borrower asked to be called later) ----
export function scheduleCallback(loanId: string, customerId: string, scheduledFor: string, reason: string) {
  const db = getDb();
  const row = { id: newId("cb"), loanId, customerId, scheduledFor, reason, status: "PENDING" as const, createdAt: new Date().toISOString() };
  db.callbacks.push(row); persist();
  return row;
}
export function listCallbacks() { return getDb().callbacks; }

// ---- semantic memory (cross-call history of what was discussed) ----
export function recentMemory(customerId: string, limit = 4) {
  return getDb().semanticMemory
    .filter((m) => m.customerId === customerId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}
export function writeMemory(customerId: string, content: string, language: string, opts?: { loanId?: string; sourceCallSid?: string }) {
  const db = getDb();
  db.semanticMemory.push({ id: newId("sm"), customerId, content, language, loanId: opts?.loanId, sourceCallSid: opts?.sourceCallSid, createdAt: new Date().toISOString() });
  persist();
}

// ---- human handoff queue ----
export function queueHandoff(loanId: string, customerId: string, reason: string): void {
  const db = getDb();
  if (!db.handoffQueue.some((h) => h.loanId === loanId && h.reason === reason)) {
    db.handoffQueue.push({ id: newId("ho"), loanId, customerId, reason, createdAt: new Date().toISOString() });
    persist();
  }
}
export function listHandoffs() { return getDb().handoffQueue; }

// ---- loans (bulk) ----
export function listLoans(): Loan[] { return getDb().loans; }
export function updateLoan(id: string, patch: Partial<Loan>): void {
  const db = getDb();
  const i = db.loans.findIndex((l) => l.id === id);
  if (i >= 0) { db.loans[i] = { ...db.loans[i], ...patch }; persist(); }
}
export function listCustomers(): Customer[] { return getDb().customers; }

// ---- DND ----
export function isOnInternalDnc(phone: string): boolean {
  return getDb().dncNumbers.includes(phone);
}
export function addToDnc(phone: string): void {
  const db = getDb();
  if (!db.dncNumbers.includes(phone)) { db.dncNumbers.push(phone); persist(); }
}
