// GET /api/ops — operations view: unmatched-payment queue + audit-log tail.
// Read requires role "compliance" (the audit trail is sensitive); PII stays masked upstream.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { requireRole, HttpError } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    requireRole(req, "compliance");
    const db = getDb();
    return NextResponse.json({
      unmatched: db.unmatchedPayments.slice(-50).reverse(),
      audit: db.auditLog.slice(-100).reverse(),
      gateDecisions: db.interactionLogs
        .filter((i) => i.outcome.startsWith("GATE_"))
        .slice(-50).reverse(),
    });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
