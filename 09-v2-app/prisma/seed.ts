// prisma/seed.ts — loads the real CBS export (database-backup.json) into PostgreSQL
// (BUILD_STEPS Step 1). Field names match SCHEMA.md exactly, so rows load unmapped.
// Run: DATABASE_URL=postgresql://... npx tsx prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const SEED_PATH = process.env.SAHAYAK_SEED_PATH
  || path.resolve(process.cwd(), "..", "02-data-and-schema", "database-backup.json");

const d = (v: unknown): Date | null => (v ? new Date(String(v)) : null);
const dd = (v: unknown, fallback = new Date()): Date => (v ? new Date(String(v)) : fallback);

async function main() {
  const raw = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));

  console.log("Seeding from", SEED_PATH);

  await prisma.customer.createMany({
    data: (raw.Customer ?? []).map((c: any) => ({
      id: c.id, customerId: c.customerId, name: c.name,
      maskedAadhaar: c.maskedAadhaar, maskedPan: c.maskedPan,
      preferredLanguage: c.preferredLanguage, phone: c.phone, altPhone: c.altPhone,
      email: c.email, addressLine: c.addressLine, city: c.city, state: c.state,
      pincode: c.pincode, consentSms: c.consentSms, consentWhatsapp: c.consentWhatsapp,
      consentVoice: c.consentVoice, suppressionFlags: c.suppressionFlags,
      createdAt: dd(c.createdAt), updatedAt: dd(c.updatedAt),
    })),
    skipDuplicates: true,
  });

  await prisma.loan.createMany({
    data: (raw.Loan ?? []).map((l: any) => ({
      id: l.id, loanId: l.loanId, customerId: l.customerId, productType: l.productType,
      principal: l.principal, sanctionedDate: d(l.sanctionedDate), tenureMonths: l.tenureMonths,
      interestRate: l.interestRate, emiAmount: l.emiAmount, disbursalDate: d(l.disbursalDate),
      totalOutstanding: l.totalOutstanding, pendingAmount: l.pendingAmount,
      pendingInstallments: l.pendingInstallments, nextDueDate: d(l.nextDueDate),
      assetClassification: l.assetClassification, dpd: l.dpd,
      npaSinceDate: d(l.npaSinceDate), sarfaesiNoticeDate: d(l.sarfaesiNoticeDate),
      lastRecomputedAt: d(l.lastRecomputedAt),
      createdAt: dd(l.createdAt), updatedAt: dd(l.updatedAt),
    })),
    skipDuplicates: true,
  });

  // 16k rows — chunked createMany
  const installments = (raw.Installment ?? []).map((i: any) => ({
    id: i.id, loanId: i.loanId, installmentNo: i.installmentNo, dueDate: dd(i.dueDate),
    installmentAmount: i.installmentAmount, paidFlag: i.paidFlag, paidDate: d(i.paidDate),
    paidAmount: i.paidAmount, daysPastDue: i.daysPastDue,
    createdAt: dd(i.createdAt), updatedAt: dd(i.updatedAt),
  }));
  for (let i = 0; i < installments.length; i += 2000) {
    await prisma.installment.createMany({ data: installments.slice(i, i + 2000), skipDuplicates: true });
  }

  await prisma.guarantor.createMany({
    data: (raw.Guarantor ?? []).map((g: any) => ({
      id: g.id, guarantorId: g.guarantorId, linkedLoanId: g.linkedLoanId,
      customerId: g.customerId, name: g.name, phone: g.phone, relationship: g.relationship,
      consentWhatsapp: g.consentWhatsapp, consentVoice: g.consentVoice,
      escalationStatus: g.escalationStatus, lastEscalatedAt: d(g.lastEscalatedAt),
      createdAt: dd(g.createdAt), updatedAt: dd(g.updatedAt),
    })),
    skipDuplicates: true,
  });

  await prisma.interactionLog.createMany({
    data: (raw.InteractionLog ?? []).map((i: any) => ({
      id: i.id, customerId: i.customerId, loanId: i.loanId, channel: i.channel,
      direction: i.direction, language: i.language, startedAt: dd(i.startedAt),
      endedAt: d(i.endedAt), outcome: i.outcome, outcomeNotes: i.outcomeNotes ? String(i.outcomeNotes) : null,
      promiseToPayDate: d(i.promiseToPayDate), promiseToPayAmount: i.promiseToPayAmount,
      recordingUrl: i.recordingUrl, transcript: i.transcript ? String(i.transcript) : null,
      sentimentScore: i.sentimentScore, complianceGate: i.complianceGate ?? "{}",
      agentType: i.agentType ?? "AI", humanAgentId: i.humanAgentId, createdAt: dd(i.createdAt),
    })),
    skipDuplicates: true,
  });

  await prisma.whatsappTemplate.createMany({
    data: (raw.WhatsappTemplate ?? []).map((t: any) => ({
      id: t.id, templateName: t.templateName, category: t.category, language: t.language,
      bodyText: t.bodyText, headerType: t.headerType, headerText: t.headerText,
      buttonText: t.buttonText, buttonUrl: t.buttonUrl, status: t.status,
      variablesSchema: t.variablesSchema, createdAt: dd(t.createdAt), updatedAt: dd(t.updatedAt),
    })),
    skipDuplicates: true,
  });

  await prisma.whatsappMessage.createMany({
    data: (raw.WhatsappMessage ?? []).map((m: any) => ({
      id: m.id, customerId: m.customerId, loanId: m.loanId, templateId: m.templateId,
      direction: m.direction, toPhone: m.toPhone, fromPhone: m.fromPhone,
      body: String(m.body ?? ""), status: m.status, wamid: m.wamid,
      errorMessage: m.errorMessage, variables: m.variables,
      sentAt: dd(m.sentAt), deliveredAt: d(m.deliveredAt), readAt: d(m.readAt),
      createdAt: dd(m.createdAt),
    })),
    skipDuplicates: true,
  });

  await prisma.voiceCall.createMany({
    data: (raw.VoiceCall ?? []).map((v: any) => ({
      id: v.id, customerId: v.customerId, loanId: v.loanId, direction: v.direction,
      toPhone: v.toPhone, fromPhone: v.fromPhone, language: v.language,
      detectedLanguage: v.detectedLanguage, startedAt: dd(v.startedAt), endedAt: d(v.endedAt),
      durationSec: v.durationSec, status: v.status, outcome: v.outcome,
      transcript: v.transcript ? String(v.transcript) : null, recordingUrl: v.recordingUrl,
      ttsEngine: v.ttsEngine, asrEngine: v.asrEngine, llmEngine: v.llmEngine, llmModel: v.llmModel,
      sentimentScore: v.sentimentScore, emotionTags: v.emotionTags,
      complianceGate: v.complianceGate, agentType: v.agentType, humanAgentId: v.humanAgentId,
      createdAt: dd(v.createdAt),
    })),
    skipDuplicates: true,
  });

  await prisma.agentNote.createMany({
    data: (raw.AgentNote ?? []).map((n: any) => ({
      id: n.id, customerId: n.customerId, loanId: n.loanId, agentId: n.agentId,
      agentName: n.agentName, note: n.note, tags: n.tags, createdAt: dd(n.createdAt),
    })),
    skipDuplicates: true,
  });

  await prisma.semanticMemory.createMany({
    data: (raw.SemanticMemory ?? []).map((s: any) => ({
      id: s.id, customerId: s.customerId, sourceInteractionId: s.sourceInteractionId,
      content: String(s.content ?? ""), embedding: s.embedding, language: s.language,
      createdAt: dd(s.createdAt),
    })),
    skipDuplicates: true,
  });

  await prisma.systemConfig.createMany({
    data: (raw.SystemConfig ?? []).map((c: any) => ({
      id: c.id, key: c.key, value: c.value, category: c.category,
      description: c.description, isSecret: c.isSecret ?? false, updatedAt: dd(c.updatedAt),
    })),
    skipDuplicates: true,
  });

  await prisma.npaRun.createMany({
    data: (raw.NpaRun ?? []).map((r: any) => ({
      id: r.id, startedAt: dd(r.startedAt), finishedAt: dd(r.finishedAt),
      loansProcessed: r.loansProcessed, newNpaCount: r.newNpaCount,
      escalatedToGuarantor: r.escalatedToGuarantor, status: r.status, details: r.details,
    })),
    skipDuplicates: true,
  });

  const counts = {
    Customer: await prisma.customer.count(),
    Loan: await prisma.loan.count(),
    Installment: await prisma.installment.count(),
    Guarantor: await prisma.guarantor.count(),
    InteractionLog: await prisma.interactionLog.count(),
    WhatsappTemplate: await prisma.whatsappTemplate.count(),
    WhatsappMessage: await prisma.whatsappMessage.count(),
    VoiceCall: await prisma.voiceCall.count(),
    AgentNote: await prisma.agentNote.count(),
    SemanticMemory: await prisma.semanticMemory.count(),
    SystemConfig: await prisma.systemConfig.count(),
    NpaRun: await prisma.npaRun.count(),
  };
  console.table(counts);

  // Expected (SCHEMA.md): 64 / 131 / 16344 / 99 / 181 / 10 / 84 / 97 / 30 / 52 / 26 / 1
  const expected: Record<string, number> = {
    Customer: 64, Loan: 131, Installment: 16344, Guarantor: 99, InteractionLog: 181,
    WhatsappTemplate: 10, WhatsappMessage: 84, VoiceCall: 97, AgentNote: 30,
    SemanticMemory: 52, SystemConfig: 26, NpaRun: 1,
  };
  const mismatches = Object.entries(expected).filter(([k, v]) => (counts as any)[k] !== v);
  if (mismatches.length) {
    console.error("ROW COUNT MISMATCH:", mismatches);
    process.exit(1);
  }
  console.log("✅ all 12 tables match SCHEMA.md row counts");
}

main().finally(() => prisma.$disconnect());
