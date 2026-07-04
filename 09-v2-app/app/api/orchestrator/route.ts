// GET  /api/orchestrator — business rules + human-handoff queue.
// POST /api/orchestrator — { action: "run", limit? }        → run a cycle (officer+)
//                          { action: "toggle-rule", id, enabled } → enable/disable a rule
//                          { action: "escalate-guarantor", loanId } → manual escalation
// Default rules can be toggled, never deleted.

import { NextResponse } from "next/server";
import { runCycle, escalateToGuarantor } from "@/lib/orchestrator";
import { ensureRules, toggleRule } from "@/lib/business-rules";
import { listHandoffs } from "@/lib/db";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  return NextResponse.json({ rules: ensureRules(), handoffs: listHandoffs() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "run") {
      const actor = requireRole(req, "officer");
      const res = await runCycle(Number(body.limit) || 50);
      writeAudit({ actor: actor.name, role: actor.role, action: "ORCHESTRATOR_RUN",
        entity: "Orchestrator", details: res.summary });
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "toggle-rule") {
      const actor = requireRole(req, "compliance"); // rule changes are a compliance decision
      const rule = toggleRule(body.id, !!body.enabled);
      if (!rule) return NextResponse.json({ error: "rule not found" }, { status: 404 });
      writeAudit({ actor: actor.name, role: actor.role, action: "RULE_TOGGLE",
        entity: "BusinessRule", entityId: body.id, details: { enabled: body.enabled } });
      return NextResponse.json({ ok: true, rule });
    }

    if (body.action === "escalate-guarantor") {
      const actor = requireRole(req, "officer");
      const res = await escalateToGuarantor(body.loanId, actor.name);
      writeAudit({ actor: actor.name, role: actor.role, action: "GUARANTOR_ESCALATE",
        entity: "Loan", entityId: body.loanId, details: res });
      return NextResponse.json({ ok: true, ...res });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
