// GET  /api/legal/cases — cases + upcoming hearings/deadlines (14-day window), PII-masked.
// POST /api/legal/cases — { action: "create" | "advance" | "hearing", ... }
// RBAC: reads officer+; stage transitions officer+; filing/possession transitions require
// role "compliance" (human approval — never auto). All writes audit-logged.

import { NextResponse } from "next/server";
import {
  createCase, advanceStage, setHearing, upcomingObligations,
  listCasesWithHistory, advocatePerformance, RESTRICTED_STAGES, CaseStage,
} from "@/lib/legal-tracker";
import { findLoanByLoanId } from "@/lib/db";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  return NextResponse.json({
    cases: listCasesWithHistory(),
    upcoming: upcomingObligations(14),
    advocates: advocatePerformance(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "create") {
      const actor = requireRole(req, "officer");
      const loan = findLoanByLoanId(body.loanId);
      if (!loan) return NextResponse.json({ error: "loan not found" }, { status: 404 });
      const row = createCase({
        loanId: body.loanId, customerId: loan.customer.id, type: body.type,
        court: body.court, caseNumber: body.caseNumber, advocateId: body.advocateId,
        nextHearing: body.nextHearing, by: actor.name,
      });
      writeAudit({ actor: actor.name, role: actor.role, action: "LEGAL_CASE_CREATE",
        entity: "LegalCase", entityId: row.id, details: { loanId: body.loanId, type: body.type } });
      return NextResponse.json({ ok: true, case: row });
    }

    if (body.action === "advance") {
      const to = body.toStage as CaseStage;
      // Filings/possession are legal ACTION → compliance/legal role, human approval.
      const actor = RESTRICTED_STAGES.includes(to)
        ? requireRole(req, "compliance")
        : requireRole(req, "officer");
      const row = advanceStage(body.caseId, to, body.note || "", actor.name);
      writeAudit({ actor: actor.name, role: actor.role, action: "LEGAL_STAGE_ADVANCE",
        entity: "LegalCase", entityId: body.caseId, details: { toStage: to, note: body.note } });
      return NextResponse.json({ ok: true, case: row });
    }

    if (body.action === "hearing") {
      const actor = requireRole(req, "officer");
      const row = setHearing(body.caseId, body.when, body.court, actor.name);
      writeAudit({ actor: actor.name, role: actor.role, action: "LEGAL_HEARING_SET",
        entity: "LegalCase", entityId: body.caseId, details: { when: body.when } });
      return NextResponse.json({ ok: true, case: row });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error && e.message.includes("not found"))
      return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
