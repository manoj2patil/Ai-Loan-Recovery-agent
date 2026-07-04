// POST /api/outreach — manual gated outreach from the Borrower-360 panel.
// { type: "whatsapp", loanId, template? } | { type: "voice", loanId }
// Both run the full Compliance Gate; both are audit-logged.

import { NextResponse } from "next/server";
import { sendNotice } from "@/lib/whatsapp";
import { placeCall } from "@/lib/voice";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "officer");
    const body = await req.json();

    if (body.type === "whatsapp") {
      const res = await sendNotice(body.loanId, body.template);
      writeAudit({ actor: actor.name, role: actor.role, action: "WHATSAPP_SEND",
        entity: "Loan", entityId: body.loanId,
        details: { sent: res.sent, template: res.sent ? res.template : undefined, gate: res.gate.verdict } });
      return NextResponse.json({ ok: res.sent, ...res });
    }

    if (body.type === "voice") {
      const res = await placeCall(body.loanId, { intentNote: "manual outreach" });
      writeAudit({ actor: actor.name, role: actor.role, action: "VOICE_CALL",
        entity: "Loan", entityId: body.loanId,
        details: { placed: res.placed, gate: res.gate.verdict } });
      return NextResponse.json({ ok: res.placed, ...res });
    }

    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
