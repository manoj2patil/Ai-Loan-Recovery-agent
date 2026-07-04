// GET /api/data/export?entity=loans|interactions — PII-masked CSV export (Phase 1 ★:
// masking applies to EXPORTS, not just the UI). Officer role required; export is audited.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit, maskName, maskPhone } from "@/lib/audit";

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

export async function GET(req: Request) {
  try {
    const actor = requireRole(req, "officer");
    const entity = new URL(req.url).searchParams.get("entity") ?? "loans";
    const db = getDb();
    const customerById = new Map(db.customers.map((c) => [c.id, c]));

    let body: string;
    if (entity === "loans") {
      body = csv([
        ["loanId", "borrower", "phone", "product", "principal", "emi", "outstanding", "dpd", "classification"],
        ...db.loans.map((l) => {
          const c = customerById.get(l.customerId);
          return [l.loanId, c ? maskName(c.name) : "", c ? maskPhone(c.phone) : "",
            l.productType, l.principal, l.emiAmount, l.totalOutstanding, l.dpd, l.assetClassification];
        }),
      ]);
    } else if (entity === "interactions") {
      body = csv([
        ["at", "loanId", "channel", "direction", "outcome", "gate"],
        ...db.interactionLogs.slice(-2000).map((i) =>
          [i.createdAt, i.loanId ?? "", i.channel, i.direction, i.outcome, i.gateVerdict ?? ""]),
      ]);
    } else {
      return NextResponse.json({ error: "entity must be loans|interactions" }, { status: 400 });
    }

    writeAudit({ actor: actor.name, role: actor.role, action: "DATA_EXPORT", entity, details: { rows: body.split("\n").length - 1 } });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sahayak-${entity}-masked.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
