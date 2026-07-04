// src/lib/legal-tracker.ts — Legal case tracking beyond drafting (Phase 5.5 ★), wired.
// SARFAESI / Section 138 / Arbitration cases, hearing calendar, statutory notice clocks,
// advocate performance. This module TRACKS — filings/possession are human-approved upstream
// (the route enforces role "compliance" on those transitions); it never auto-executes.

import {
  insertLegalCase, findLegalCase, updateLegalCase, listLegalCases,
  insertCaseHistory, caseHistory, logInteraction,
} from "./db";
import { LegalCaseRow } from "./store";

export type CaseType = "SARFAESI" | "SEC_138" | "ARBITRATION";
export type CaseStage =
  | "NOTICE_DRAFTED" | "NOTICE_SERVED" | "REPLY_WINDOW" | "POSSESSION_13_4"
  | "COMPLAINT_FILED" | "HEARING" | "ORDER" | "SETTLED" | "CLOSED";

/** Stages that constitute legal ACTION — require role "compliance" (human approval). */
export const RESTRICTED_STAGES: CaseStage[] = ["POSSESSION_13_4", "COMPLAINT_FILED"];

/** Statutory clocks (V2_INTEGRATION compliance note: have the bank's counsel confirm
 *  these day-counts before go-live):
 *  SARFAESI: 13(2) demand notice → 60 days for the borrower to discharge; then 13(4).
 *  Sec 138: demand notice → drawer has 15 days to pay → complaint within 1 month. */
export function computeDeadline(type: CaseType, stage: CaseStage, anchor: Date): Date | undefined {
  const d = (days: number) => new Date(anchor.getTime() + days * 86400000);
  if (type === "SARFAESI" && stage === "NOTICE_SERVED") return d(60);   // 13(2) window
  if (type === "SEC_138" && stage === "NOTICE_SERVED") return d(15);    // drawer pay window
  if (type === "SEC_138" && stage === "REPLY_WINDOW") return d(30);     // complaint filing
  return undefined;
}

export function createCase(opts: {
  loanId: string; customerId: string; type: CaseType;
  court?: string; caseNumber?: string; advocateId?: string; nextHearing?: string; by: string;
}): LegalCaseRow {
  const row = insertLegalCase({
    loanId: opts.loanId, customerId: opts.customerId, type: opts.type,
    stage: "NOTICE_DRAFTED", court: opts.court, caseNumber: opts.caseNumber,
    advocateId: opts.advocateId, nextHearing: opts.nextHearing, documents: [],
  });
  insertCaseHistory({ caseId: row.id, stage: "NOTICE_DRAFTED", note: "case opened", by: opts.by });
  logInteraction({
    customerId: opts.customerId, loanId: opts.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "LEGAL_CASE_OPENED", details: { caseId: row.id, type: opts.type },
  });
  return row;
}

/** Stage transition with audit history. The ROUTE checks RBAC before calling this. */
export function advanceStage(caseId: string, to: CaseStage, note: string, by: string): LegalCaseRow {
  const c = findLegalCase(caseId);
  if (!c) throw new Error("case not found");
  const noticeDate = to === "NOTICE_SERVED" ? new Date().toISOString() : c.noticeDate;
  const anchor = to === "NOTICE_SERVED" ? new Date() : new Date(c.noticeDate || Date.now());
  const deadline = computeDeadline(c.type as CaseType, to, anchor);
  updateLegalCase(caseId, {
    stage: to, noticeDate,
    statutoryDeadline: deadline ? deadline.toISOString() : c.statutoryDeadline,
  });
  insertCaseHistory({ caseId, stage: to, note, by });
  return findLegalCase(caseId)!;
}

export function setHearing(caseId: string, when: string, court: string | undefined, by: string): LegalCaseRow {
  const c = findLegalCase(caseId);
  if (!c) throw new Error("case not found");
  updateLegalCase(caseId, { nextHearing: when, court: court ?? c.court });
  insertCaseHistory({ caseId, stage: c.stage, note: `hearing listed ${when}`, by });
  return findLegalCase(caseId)!;
}

/** Upcoming obligations for the dashboard + the daily reminder cron (V2_INTEGRATION §4). */
export function upcomingObligations(withinDays = 14) {
  const now = Date.now(); const horizon = now + withinDays * 86400000;
  return listLegalCases().flatMap((c) => {
    const items: { caseId: string; kind: "HEARING" | "DEADLINE"; when: string; label: string }[] = [];
    if (c.nextHearing && Date.parse(c.nextHearing) <= horizon && Date.parse(c.nextHearing) >= now)
      items.push({ caseId: c.id, kind: "HEARING", when: c.nextHearing,
                   label: `${c.type} hearing · ${c.court || ""} ${c.caseNumber || ""}`.trim() });
    if (c.statutoryDeadline && Date.parse(c.statutoryDeadline) <= horizon && Date.parse(c.statutoryDeadline) >= now)
      items.push({ caseId: c.id, kind: "DEADLINE", when: c.statutoryDeadline,
                   label: `${c.type} statutory deadline (${c.stage})` });
    return items;
  }).sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
}

export function listCasesWithHistory() {
  return listLegalCases().map((c) => ({ ...c, history: caseHistory(c.id) }));
}

/** Advocate performance rollup (assignment quality signal). */
export function advocatePerformance() {
  const byAdv: Record<string, { total: number; settled: number; avgDaysOpen: number }> = {};
  for (const c of listLegalCases()) {
    if (!c.advocateId) continue;
    const a = (byAdv[c.advocateId] ||= { total: 0, settled: 0, avgDaysOpen: 0 });
    a.total++;
    if (c.stage === "SETTLED" || c.stage === "CLOSED") a.settled++;
    a.avgDaysOpen += (Date.now() - Date.parse(c.createdAt)) / 86400000;
  }
  for (const k of Object.keys(byAdv)) byAdv[k].avgDaysOpen = Math.round(byAdv[k].avgDaysOpen / byAdv[k].total);
  return byAdv;
}
