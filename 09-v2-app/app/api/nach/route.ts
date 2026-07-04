// GET  /api/nach — mandate status per loan.
// POST /api/nach — { action: "register" | "presentment", ... }
// Presentment results normally arrive from the sponsor bank's response file; the route
// accepts them so the file processor (or a sandbox demo) can post outcomes.
// All writes RBAC-guarded (officer+) and audit-logged.

import { NextResponse } from "next/server";
import { registerMandate, recordPresentment, mandateView } from "@/lib/nach";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  return NextResponse.json({ mandates: mandateView() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "register") {
      const actor = requireRole(req, "officer");
      const mandate = registerMandate({
        loanId: body.loanId, umrn: body.umrn, bank: body.bank,
        amountCap: Number(body.amountCap), nextPresentation: body.nextPresentation,
      });
      writeAudit({ actor: actor.name, role: actor.role, action: "NACH_REGISTER",
        entity: "NachMandate", entityId: mandate.id, details: { loanId: body.loanId, umrn: body.umrn } });
      return NextResponse.json({ ok: true, mandate });
    }

    if (body.action === "presentment") {
      const actor = requireRole(req, "officer");
      const result = await recordPresentment({
        mandateId: body.mandateId, outcome: body.outcome,
        amount: Number(body.amount), reason: body.reason, utr: body.utr,
      });
      writeAudit({ actor: actor.name, role: actor.role, action: "NACH_PRESENTMENT",
        entity: "NachMandate", entityId: body.mandateId,
        details: { outcome: body.outcome, amount: body.amount, reason: body.reason } });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
