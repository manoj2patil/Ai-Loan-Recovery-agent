// src/lib/legal-tracker.ts — Legal case tracking beyond drafting (Phase 5.5 ★).
// SARFAESI / Section 138 / Arbitration cases, hearing calendar + reminders, statutory
// notice clocks, advocate assignment + performance. Benchmark: Credgenics legal module.

export type CaseType = "SARFAESI" | "SEC_138" | "ARBITRATION";
export type CaseStage =
  | "NOTICE_DRAFTED" | "NOTICE_SERVED" | "REPLY_WINDOW" | "POSSESSION_13_4"
  | "COMPLAINT_FILED" | "HEARING" | "ORDER" | "SETTLED" | "CLOSED";

export interface LegalCase {
  id: string; loanId: string; customerId: string;
  type: CaseType; stage: CaseStage;
  noticeDate?: Date;           // 13(2) date / demand-notice date
  statutoryDeadline?: Date;    // computed clock (below)
  nextHearing?: Date; court?: string; caseNumber?: string;
  advocateId?: string;
  documents: string[];         // vault refs
  history: { at: Date; stage: CaseStage; note: string; by: string }[];
}

/** Statutory clocks (verify with counsel; encoded per current practice):
 *  SARFAESI: 13(2) demand notice → 60 days for borrower to discharge; then 13(4) possession.
 *  Sec 138: demand notice within 30 days of cheque return → drawer has 15 days to pay →
 *           complaint within 1 month of cause of action. */
export function computeDeadline(type: CaseType, stage: CaseStage, anchor: Date): Date | undefined {
  const d = (days: number) => new Date(anchor.getTime() + days * 86400000);
  if (type === "SARFAESI" && stage === "NOTICE_SERVED") return d(60);   // 13(2) window
  if (type === "SEC_138" && stage === "NOTICE_SERVED") return d(15);    // drawer pay window
  if (type === "SEC_138" && stage === "REPLY_WINDOW") return d(30);     // complaint filing
  return undefined;
}

/** Upcoming obligations for the dashboard + reminder cron. */
export function upcomingObligations(cases: LegalCase[], withinDays = 14) {
  const now = Date.now(); const horizon = now + withinDays * 86400000;
  return cases.flatMap((c) => {
    const items: { caseId: string; kind: "HEARING" | "DEADLINE"; when: Date; label: string }[] = [];
    if (c.nextHearing && +c.nextHearing <= horizon)
      items.push({ caseId: c.id, kind: "HEARING", when: c.nextHearing,
                   label: `${c.type} hearing · ${c.court || ""} ${c.caseNumber || ""}` });
    if (c.statutoryDeadline && +c.statutoryDeadline <= horizon)
      items.push({ caseId: c.id, kind: "DEADLINE", when: c.statutoryDeadline,
                   label: `${c.type} statutory deadline (${c.stage})` });
    return items;
  }).sort((a, b) => +a.when - +b.when);
}

/** Stage transition with audit history. Human/advocate approval is REQUIRED upstream for any
 *  filing/possession action — this module tracks, it never auto-executes legal action. */
export function advanceStage(c: LegalCase, to: CaseStage, note: string, by: string): LegalCase {
  const anchor = to === "NOTICE_SERVED" ? new Date() : c.noticeDate || new Date();
  return {
    ...c, stage: to,
    noticeDate: to === "NOTICE_SERVED" ? new Date() : c.noticeDate,
    statutoryDeadline: computeDeadline(c.type, to, anchor) || c.statutoryDeadline,
    history: [...c.history, { at: new Date(), stage: to, note, by }],
  };
}

/** Advocate performance rollup (assignment quality signal). */
export function advocatePerformance(cases: LegalCase[]) {
  const byAdv: Record<string, { total: number; settled: number; avgDaysOpen: number }> = {};
  for (const c of cases) {
    if (!c.advocateId) continue;
    const a = (byAdv[c.advocateId] ||= { total: 0, settled: 0, avgDaysOpen: 0 });
    a.total++; if (c.stage === "SETTLED" || c.stage === "CLOSED") a.settled++;
    const opened = c.history[0]?.at || new Date();
    a.avgDaysOpen += (Date.now() - +opened) / 86400000;
  }
  for (const k of Object.keys(byAdv)) byAdv[k].avgDaysOpen = Math.round(byAdv[k].avgDaysOpen / byAdv[k].total);
  return byAdv;
}
