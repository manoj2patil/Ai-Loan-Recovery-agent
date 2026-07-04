// GET  /api/portfolio — book stats, DPD buckets, classification + propensity segments.
// POST /api/portfolio — { action: "run-npa" } → recompute classifications (compliance role).

import { NextResponse } from "next/server";
import { portfolioStats, runNpaEngine } from "@/lib/portfolio";
import { propensitySegments } from "@/lib/propensity";
import { listLoans, findCustomerById } from "@/lib/db";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { maskName } from "@/lib/audit";

export async function GET() {
  const loans = listLoans()
    .filter((l) => l.dpd > 0)
    .sort((a, b) => b.dpd - a.dpd)
    .slice(0, 100)
    .map((l) => ({
      loanId: l.loanId, product: l.productType, dpd: l.dpd,
      classification: l.assetClassification,
      outstanding: l.totalOutstanding, emi: l.emiAmount,
      borrower: maskName(findCustomerById(l.customerId)?.name ?? "—"),
    }));
  return NextResponse.json({ stats: portfolioStats(), segments: propensitySegments(), loans });
}

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "compliance");
    const { action } = await req.json();
    if (action !== "run-npa") return NextResponse.json({ error: "unknown action" }, { status: 400 });
    const run = runNpaEngine();
    writeAudit({ actor: actor.name, role: actor.role, action: "NPA_RUN", entity: "NpaRun", details: run });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
