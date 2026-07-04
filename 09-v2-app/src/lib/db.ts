// src/lib/db.ts — data access for the v2 modules. Every function here maps 1:1 onto a
// Prisma call against the models in prisma/schema.prisma; swap the store import for the
// Prisma client when moving to PostgreSQL.

import {
  getDb, persist, newId,
  Customer, Loan, PaymentLinkRow, Ptp, Suppression, InteractionLog,
  LegalCaseRow, LegalCaseHistoryRow, FieldVisitRow, UnmatchedPayment,
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

// ---- DND ----
export function isOnInternalDnc(phone: string): boolean {
  return getDb().dncNumbers.includes(phone);
}
export function addToDnc(phone: string): void {
  const db = getDb();
  if (!db.dncNumbers.includes(phone)) { db.dncNumbers.push(phone); persist(); }
}
