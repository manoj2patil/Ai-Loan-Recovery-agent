// src/lib/data/prisma-db.ts — the PostgreSQL data adapter (async twin of src/lib/db.ts).
// Every function mirrors a JSON-store accessor 1:1 against the models in
// prisma/schema.prisma. The JSON columns from the CBS export stay stringified in the DB
// (exactly as exported) and are parsed here, so both adapters return identical shapes.
//
// Swap status: prisma/seed.ts loads the CBS export (verified: all 12 tables match
// SCHEMA.md row counts) and tests/prisma-parity.test.mts proves both adapters agree.
// Routes still call the sync JSON adapter by default; flipping a lib to Postgres means
// importing from "./data/prisma-db" and awaiting — the shapes are already identical.

import { PrismaClient } from "@prisma/client";
import type { Customer, Loan, Guarantor, Suppression, InteractionLog } from "../store";

let client: PrismaClient | null = null;
export function prisma(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — Postgres adapter unavailable");
  return (client ??= new PrismaClient());
}

const j = <T,>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return (s as T) ?? fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

function toCustomer(c: any): Customer {
  return {
    id: c.id, customerId: c.customerId, name: c.name, phone: c.phone,
    preferredLanguage: c.preferredLanguage, city: c.city ?? undefined, state: c.state ?? undefined,
    consentSms: j(c.consentSms, { granted: false }),
    consentWhatsapp: j(c.consentWhatsapp, { granted: false }),
    consentVoice: j(c.consentVoice, { granted: false }),
    suppressionFlags: j(c.suppressionFlags, { doNotCall: false, bankruptcyNotice: false, deceased: false }),
  };
}

function toLoan(l: any): Loan {
  return {
    id: l.id, loanId: l.loanId, customerId: l.customerId, productType: l.productType,
    principal: l.principal, emiAmount: l.emiAmount, tenureMonths: l.tenureMonths,
    totalOutstanding: l.totalOutstanding, pendingAmount: l.pendingAmount,
    pendingInstallments: l.pendingInstallments,
    nextDueDate: l.nextDueDate?.toISOString(), dpd: l.dpd,
    assetClassification: l.assetClassification,
    npaSinceDate: l.npaSinceDate?.toISOString(),
    sarfaesiNoticeDate: l.sarfaesiNoticeDate?.toISOString(),
  };
}

// ---- lookups (async twins of db.ts) ----

export async function findLoanByLoanId(loanId: string): Promise<(Loan & { customer: Customer }) | null> {
  const loan = await prisma().loan.findUnique({ where: { loanId }, include: { customer: true } });
  if (!loan) return null;
  return { ...toLoan(loan), customer: toCustomer(loan.customer) };
}

export async function findCustomerById(id: string): Promise<Customer | null> {
  const c = await prisma().customer.findFirst({ where: { OR: [{ id }, { customerId: id }] } });
  return c ? toCustomer(c) : null;
}

export async function listLoans(): Promise<Loan[]> {
  return (await prisma().loan.findMany()).map(toLoan);
}

export async function guarantorsForLoan(loanDbId: string): Promise<Guarantor[]> {
  const rows = await prisma().guarantor.findMany({ where: { linkedLoanId: loanDbId } });
  return rows.map((g) => ({
    id: g.id, guarantorId: g.guarantorId, linkedLoanId: g.linkedLoanId,
    customerId: g.customerId ?? undefined, name: g.name, phone: g.phone,
    relationship: g.relationship,
    consentWhatsapp: j(g.consentWhatsapp, { granted: false }),
    consentVoice: j(g.consentVoice, { granted: false }),
    escalationStatus: g.escalationStatus as Guarantor["escalationStatus"],
    lastEscalatedAt: g.lastEscalatedAt?.toISOString(),
  }));
}

export async function getConfig(key: string, fallback: string): Promise<string> {
  const row = await prisma().systemConfig.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function activeSuppressions(customerId: string): Promise<Suppression[]> {
  const rows = await prisma().suppression.findMany({
    where: { customerId, active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
  });
  return rows.map((s) => ({
    id: s.id, customerId: s.customerId, reason: s.reason, active: s.active,
    createdAt: s.createdAt.toISOString(), endsAt: s.endsAt?.toISOString(),
  }));
}

export async function insertSuppression(s: { customerId: string; reason: string; endsAt?: string }) {
  return prisma().suppression.create({
    data: { customerId: s.customerId, reason: s.reason, endsAt: s.endsAt ? new Date(s.endsAt) : null },
  });
}

export async function logInteraction(e: Omit<InteractionLog, "id" | "createdAt">) {
  return prisma().interactionLog.create({
    data: {
      customerId: e.customerId, loanId: e.loanId, channel: e.channel, direction: e.direction,
      outcome: e.outcome, complianceGate: JSON.stringify({ verdict: e.gateVerdict ?? null, details: e.details ?? null }),
    },
  });
}

export async function recentInteractions(customerId: string, channel: InteractionLog["channel"], days: number) {
  return prisma().interactionLog.findMany({
    where: {
      customerId, channel, direction: "OUTBOUND",
      createdAt: { gte: new Date(Date.now() - days * 86400000) },
    },
  });
}

export async function insertPaymentLink(row: {
  id: string; loanId: string; customerId: string; amount: number; purpose: string;
  status: string; utr?: string; upiDeepLink: string; webUrl: string; signature: string;
  expiresAt: string; createdAt: string; paidAt?: string;
}) {
  return prisma().paymentLink.create({
    data: {
      id: row.id, loanId: row.loanId, customerId: row.customerId, amount: row.amount,
      purpose: row.purpose, status: row.status, utr: row.utr,
      upiDeepLink: row.upiDeepLink, webUrl: row.webUrl, signature: row.signature,
      expiresAt: new Date(row.expiresAt), paidAt: row.paidAt ? new Date(row.paidAt) : null,
    },
  });
}

export async function findPaymentLink(ref: string) {
  return prisma().paymentLink.findFirst({ where: { OR: [{ id: ref }, { utr: ref }] } });
}

export async function findOpenPtp(loanId: string) {
  return prisma().ptp.findFirst({ where: { loanId, status: "OPEN" } });
}

export async function disconnect() {
  await client?.$disconnect();
  client = null;
}
