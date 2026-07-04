// src/lib/store.ts — dev data store for the v2 modules.
// A single JSON file (data/db.json) seeded from the real CBS export in
// 02-data-and-schema/database-backup.json. In production this layer is replaced by
// Prisma/PostgreSQL — the schema is in prisma/schema.prisma and every accessor in db.ts
// maps 1:1 onto a Prisma call. Keep this file free of business logic.

import fs from "fs";
import path from "path";

export type Role = "officer" | "compliance" | "admin";

export interface Customer {
  id: string;               // internal cuid — Loan.customerId points HERE (see SCHEMA.md)
  customerId: string;       // CUST10001
  name: string;
  phone: string;
  preferredLanguage: string;
  consentSms: { granted: boolean };
  consentWhatsapp: { granted: boolean };
  consentVoice: { granted: boolean };
  suppressionFlags: { doNotCall: boolean; bankruptcyNotice: boolean; deceased: boolean };
}

export interface Loan {
  id: string;
  loanId: string;           // LN500001
  customerId: string;       // → Customer.id
  productType: string;
  emiAmount: number;
  totalOutstanding: number;
  pendingAmount: number;
  dpd: number;
  assetClassification: string;
}

export interface PaymentLinkRow {
  id: string; loanId: string; customerId: string; amount: number;
  purpose: "EMI" | "PTP" | "SETTLEMENT" | "PARTIAL";
  status: "CREATED" | "PAID" | "EXPIRED" | "FAILED";
  upiDeepLink: string; webUrl: string; signature: string;
  utr?: string; expiresAt: string; createdAt: string; paidAt?: string;
}

export interface UnmatchedPayment {
  id: string; reference: string; amount: number; utr?: string; raw: unknown; createdAt: string;
}

export interface Ptp {
  id: string; loanId: string; customerId: string; amount: number; dueDate: string;
  status: "OPEN" | "KEPT" | "BROKEN" | "CANCELLED"; createdAt: string; closedAt?: string;
}

export interface Suppression {
  id: string; customerId: string; reason: string; active: boolean;
  createdAt: string; endsAt?: string;
}

export interface InteractionLog {
  id: string; customerId: string; loanId?: string;
  channel: "VOICE" | "WHATSAPP" | "SMS" | "VISIT" | "SYSTEM";
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  outcome: string; details?: unknown; gateVerdict?: string; createdAt: string;
}

export interface LegalCaseRow {
  id: string; loanId: string; customerId: string;
  type: "SARFAESI" | "SEC_138" | "ARBITRATION";
  stage: string; noticeDate?: string; statutoryDeadline?: string;
  nextHearing?: string; court?: string; caseNumber?: string; advocateId?: string;
  documents: string[]; createdAt: string;
}

export interface LegalCaseHistoryRow {
  id: string; caseId: string; stage: string; note: string; by: string; at: string;
}

export interface FieldVisitRow {
  id: string; loanId: string; customerId: string; agentId: string;
  scheduledFor: string; status: "SCHEDULED" | "EN_ROUTE" | "COMPLETED" | "NOT_MET" | "CANCELLED";
  address: string; lat?: number; lng?: number; geoAt?: string;
  outcome?: string; outcomeNote?: string;
  amountCollected?: number; receiptRef?: string; photoRefs?: string[];
}

export interface AuditRow {
  id: string; actor: string; role: Role; action: string; entity: string;
  entityId?: string; details?: unknown; at: string;
}

export interface Db {
  customers: Customer[];
  loans: Loan[];
  paymentLinks: PaymentLinkRow[];
  unmatchedPayments: UnmatchedPayment[];
  ptps: Ptp[];
  suppressions: Suppression[];
  interactionLogs: InteractionLog[];
  legalCases: LegalCaseRow[];
  legalCaseHistory: LegalCaseHistoryRow[];
  fieldVisits: FieldVisitRow[];
  auditLog: AuditRow[];
  dncNumbers: string[];     // internal do-not-contact list (stands in for the NCPR lookup)
}

const DB_PATH = path.resolve(process.cwd(), "data", "db.json");
const SEED_PATH = path.resolve(process.cwd(), "..", "02-data-and-schema", "database-backup.json");

let cache: Db | null = null;

function parseJsonString<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return (s as T) ?? fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function seed(): Db {
  const db: Db = {
    customers: [], loans: [], paymentLinks: [], unmatchedPayments: [], ptps: [],
    suppressions: [], interactionLogs: [], legalCases: [], legalCaseHistory: [],
    fieldVisits: [], auditLog: [], dncNumbers: [],
  };
  if (fs.existsSync(SEED_PATH)) {
    const raw = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
    for (const c of raw.Customer ?? []) {
      db.customers.push({
        id: c.id, customerId: c.customerId, name: c.name, phone: c.phone,
        preferredLanguage: c.preferredLanguage,
        consentSms: parseJsonString(c.consentSms, { granted: false }),
        consentWhatsapp: parseJsonString(c.consentWhatsapp, { granted: false }),
        consentVoice: parseJsonString(c.consentVoice, { granted: false }),
        suppressionFlags: parseJsonString(c.suppressionFlags, {
          doNotCall: false, bankruptcyNotice: false, deceased: false,
        }),
      });
    }
    for (const l of raw.Loan ?? []) {
      db.loans.push({
        id: l.id, loanId: l.loanId, customerId: l.customerId, productType: l.productType,
        emiAmount: l.emiAmount, totalOutstanding: l.totalOutstanding,
        pendingAmount: l.pendingAmount, dpd: l.dpd, assetClassification: l.assetClassification,
      });
    }
  }
  return db;
}

export function getDb(): Db {
  if (cache) return cache;
  if (fs.existsSync(DB_PATH)) {
    cache = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Db;
  } else {
    cache = seed();
    persist();
  }
  return cache;
}

export function persist(): void {
  if (!cache) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1));
  fs.renameSync(tmp, DB_PATH);
}

/** Test/demo helper: wipe the dev store so the next read re-seeds from the CBS export. */
export function resetDb(): void {
  cache = null;
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
