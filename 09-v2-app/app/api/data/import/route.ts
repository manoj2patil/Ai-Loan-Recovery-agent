// POST /api/data/import — CSV upsert of customers + loans (Step 11). Body: text/csv.
// POST with ?mode=cbs runs the CBS delta-sync path instead. Both admin-role + audited.

import { NextResponse } from "next/server";
import { importLoansCsv, cbsSync } from "@/lib/cbs";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "admin");
    if (new URL(req.url).searchParams.get("mode") === "cbs") {
      const res = await cbsSync();
      writeAudit({ actor: actor.name, role: actor.role, action: "CBS_SYNC", entity: "CBS", details: res });
      return NextResponse.json({ ok: true, ...res });
    }
    const summary = importLoansCsv(await req.text());
    writeAudit({ actor: actor.name, role: actor.role, action: "CSV_IMPORT", entity: "Loan",
      details: { loans: summary.loansUpserted, customers: summary.customersUpserted, rejected: summary.rejected.length } });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
