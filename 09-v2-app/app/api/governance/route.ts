// GET /api/governance — Phase 5 governance dashboard: gate decisions, channel mix,
// recovery figures, PTP performance, NPA distribution. Read-only KPIs.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { portfolioStats } from "@/lib/portfolio";

export async function GET() {
  const db = getDb();
  const since30 = Date.now() - 30 * 86400000;

  const gate: Record<string, number> = {};
  const channelMix: Record<string, number> = {};
  for (const i of db.interactionLogs) {
    if (Date.parse(i.createdAt) < since30) continue;
    if (i.outcome.startsWith("GATE_")) gate[i.outcome.slice(5)] = (gate[i.outcome.slice(5)] ?? 0) + 1;
    if (i.direction === "OUTBOUND" && i.channel !== "SYSTEM")
      channelMix[i.channel] = (channelMix[i.channel] ?? 0) + 1;
  }

  const payments = db.interactionLogs.filter((i) => i.outcome === "PAYMENT_RECEIVED");
  const recovered = payments.reduce((s, p) => s + Number((p.details as any)?.amount ?? 0), 0);
  const ptpAll = db.ptps.length;
  const ptpKept = db.ptps.filter((p) => p.status === "KEPT").length;

  return NextResponse.json({
    portfolio: portfolioStats(),
    gateDecisions30d: gate,
    channelMix30d: channelMix,
    recovery: { payments: payments.length, amount: recovered },
    ptp: { total: ptpAll, kept: ptpKept, keptRate: ptpAll ? Math.round((ptpKept / ptpAll) * 100) : null },
    activeSuppressions: db.suppressions.filter((s) => s.active && (!s.endsAt || Date.parse(s.endsAt) > Date.now())).length,
    handoffQueue: db.handoffQueue.length,
  });
}
