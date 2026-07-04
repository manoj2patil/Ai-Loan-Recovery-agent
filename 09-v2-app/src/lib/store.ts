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
  principal: number;
  emiAmount: number;
  tenureMonths: number;
  totalOutstanding: number;
  pendingAmount: number;
  pendingInstallments: number;
  nextDueDate?: string;
  dpd: number;
  assetClassification: string;
  npaSinceDate?: string;
  sarfaesiNoticeDate?: string;
}

export interface Guarantor {
  id: string; guarantorId: string; linkedLoanId: string;   // → Loan.id
  customerId?: string; name: string; phone: string; relationship: string;
  consentWhatsapp: { granted: boolean }; consentVoice: { granted: boolean };
  escalationStatus: "NONE" | "ELIGIBLE" | "NOTIFIED"; lastEscalatedAt?: string;
}

export interface WhatsappTemplateRow {
  id: string; templateName: string; category: string; language: string;
  bodyText: string; headerText?: string; buttonText?: string;
  status: string; variablesSchema: string[];
}

export interface WhatsappMessageRow {
  id: string; customerId: string; loanId?: string; templateId?: string;
  direction: "INBOUND" | "OUTBOUND"; toPhone: string; body: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  variables?: Record<string, string>;
  sentAt: string; deliveredAt?: string; readAt?: string;
}

export interface VoiceCallRow {
  id: string; customerId: string; loanId?: string;
  direction: "INBOUND" | "OUTBOUND"; toPhone: string; language: string;
  startedAt: string; endedAt?: string; durationSec: number;
  status: "INITIATED" | "COMPLETED" | "NO_ANSWER"; outcome?: string;
  transcript?: string; recordingUrl?: string; sentimentScore?: number;
  complianceGate?: unknown; agentType: "AI" | "HUMAN";
}

export interface SystemConfigRow {
  key: string; value: string; category: string; description?: string;
}

export interface BusinessRule {
  id: string; name: string; bucket: "0-30" | "31-60" | "61-90" | "91-180" | "180+";
  action: "WHATSAPP" | "VOICE" | "GUARANTOR" | "SARFAESI" | "HUMAN_HANDOFF" | "FIELD_VISIT";
  triggerDpd: number;        // fires when loan.dpd >= triggerDpd (and within bucket)
  template?: string;         // WhatsApp templateName when action=WHATSAPP
  rbiRef: string;            // the RBI/guideline reference the rule encodes
  enabled: boolean; isDefault: boolean;
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
  promiseToPayDate?: string; promiseToPayAmount?: number; sentimentScore?: number;
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

export interface NachMandate {
  id: string; loanId: string; customerId: string;
  umrn: string;             // Unique Mandate Reference Number
  bank: string; amountCap: number;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXHAUSTED";
  bounceCount: number; lastOutcome?: "SUCCESS" | "BOUNCE";
  lastPresentedAt?: string; nextPresentation?: string; createdAt: string;
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
  nachMandates: NachMandate[];
  guarantors: Guarantor[];
  whatsappTemplates: WhatsappTemplateRow[];
  whatsappMessages: WhatsappMessageRow[];
  voiceCalls: VoiceCallRow[];
  systemConfig: SystemConfigRow[];
  businessRules: BusinessRule[];
  handoffQueue: { id: string; loanId: string; customerId: string; reason: string; createdAt: string }[];
}

/** Collections added after the first release — fill them in when loading an older db.json. */
const LATER_COLLECTIONS = [
  "nachMandates", "guarantors", "whatsappTemplates", "whatsappMessages",
  "voiceCalls", "systemConfig", "businessRules", "handoffQueue",
] as const;

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
    fieldVisits: [], auditLog: [], dncNumbers: [], nachMandates: [],
    guarantors: [], whatsappTemplates: [], whatsappMessages: [], voiceCalls: [],
    systemConfig: [], businessRules: [], handoffQueue: [],
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
        principal: l.principal, emiAmount: l.emiAmount, tenureMonths: l.tenureMonths,
        totalOutstanding: l.totalOutstanding, pendingAmount: l.pendingAmount,
        pendingInstallments: l.pendingInstallments, nextDueDate: l.nextDueDate ?? undefined,
        dpd: l.dpd, assetClassification: l.assetClassification,
        npaSinceDate: l.npaSinceDate ?? undefined,
        sarfaesiNoticeDate: l.sarfaesiNoticeDate ?? undefined,
      });
    }
    for (const g of raw.Guarantor ?? []) {
      db.guarantors.push({
        id: g.id, guarantorId: g.guarantorId, linkedLoanId: g.linkedLoanId,
        customerId: g.customerId ?? undefined, name: g.name, phone: g.phone,
        relationship: g.relationship,
        consentWhatsapp: parseJsonString(g.consentWhatsapp, { granted: false }),
        consentVoice: parseJsonString(g.consentVoice, { granted: false }),
        escalationStatus: g.escalationStatus ?? "NONE",
        lastEscalatedAt: g.lastEscalatedAt ?? undefined,
      });
    }
    for (const t of raw.WhatsappTemplate ?? []) {
      db.whatsappTemplates.push({
        id: t.id, templateName: t.templateName, category: t.category, language: t.language,
        bodyText: t.bodyText, headerText: t.headerText ?? undefined,
        buttonText: t.buttonText ?? undefined, status: t.status,
        variablesSchema: parseJsonString(t.variablesSchema, []),
      });
    }
    for (const m of raw.WhatsappMessage ?? []) {
      db.whatsappMessages.push({
        id: m.id, customerId: m.customerId, loanId: m.loanId ?? undefined,
        templateId: m.templateId ?? undefined, direction: m.direction, toPhone: m.toPhone,
        body: String(m.body ?? ""), status: m.status,
        variables: parseJsonString(m.variables, undefined),
        sentAt: m.sentAt, deliveredAt: m.deliveredAt ?? undefined, readAt: m.readAt ?? undefined,
      });
    }
    for (const v of raw.VoiceCall ?? []) {
      db.voiceCalls.push({
        id: v.id, customerId: v.customerId, loanId: v.loanId ?? undefined,
        direction: v.direction, toPhone: v.toPhone, language: v.language,
        startedAt: v.startedAt, endedAt: v.endedAt ?? undefined, durationSec: v.durationSec,
        status: v.status, outcome: v.outcome ?? undefined,
        transcript: v.transcript ? String(v.transcript) : undefined,
        recordingUrl: v.recordingUrl ?? undefined,
        sentimentScore: v.sentimentScore ?? undefined,
        complianceGate: parseJsonString(v.complianceGate, undefined), agentType: v.agentType,
      });
    }
    // Historic interaction logs → same shape as live ones (channel/direction/outcome)
    for (const i of raw.InteractionLog ?? []) {
      db.interactionLogs.push({
        id: i.id, customerId: i.customerId, loanId: i.loanId ?? undefined,
        channel: i.channel, direction: i.direction, outcome: i.outcome ?? "LOGGED",
        details: { language: i.language, notes: i.outcomeNotes },
        gateVerdict: undefined, createdAt: i.startedAt ?? i.createdAt,
        promiseToPayDate: i.promiseToPayDate ?? undefined,
        promiseToPayAmount: i.promiseToPayAmount ?? undefined,
        sentimentScore: i.sentimentScore ?? undefined,
      });
    }
    for (const s of raw.SystemConfig ?? []) {
      db.systemConfig.push({ key: s.key, value: s.value, category: s.category, description: s.description });
    }
  }
  return db;
}

export function getDb(): Db {
  if (cache) return cache;
  if (fs.existsSync(DB_PATH)) {
    cache = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Db;
    for (const k of LATER_COLLECTIONS) (cache as any)[k] ??= [];
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
