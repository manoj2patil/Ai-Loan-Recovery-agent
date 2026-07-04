// GET /api/governance — Phase 5 governance dashboard: gate decisions, channel mix,
// recovery figures, PTP performance, NPA distribution. Read-only KPIs.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { portfolioStats } from "@/lib/portfolio";
import { getConfigInt } from "@/lib/config";

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

  // Channel-mix economics (Phase 5): per-touch unit costs (paise-accurate values belong in
  // SystemConfig — COST_* keys override these defaults) → cost per channel and per ₹ recovered.
  const unitCost: Record<string, number> = {
    VOICE: getConfigInt("COST_VOICE_CALL", 8),
    WHATSAPP: getConfigInt("COST_WHATSAPP_MSG", 1),
    SMS: getConfigInt("COST_SMS", 1),
    VISIT: getConfigInt("COST_FIELD_VISIT", 250),
  };
  const economics = Object.fromEntries(
    Object.entries(channelMix).map(([ch, n]) => [ch, { touches: n, cost: n * (unitCost[ch] ?? 0) }]),
  );
  const totalCost = Object.values(economics).reduce((s: number, e: any) => s + e.cost, 0);

  return NextResponse.json({
    economics: {
      byChannel: economics, totalCost,
      costPerRupeeRecovered: recovered ? Math.round((totalCost / recovered) * 10000) / 10000 : null,
    },
    portfolio: portfolioStats(),
    gateDecisions30d: gate,
    channelMix30d: channelMix,
    recovery: { payments: payments.length, amount: recovered },
    ptp: { total: ptpAll, kept: ptpKept, keptRate: ptpAll ? Math.round((ptpKept / ptpAll) * 100) : null },
    activeSuppressions: db.suppressions.filter((s) => s.active && (!s.endsAt || Date.parse(s.endsAt) > Date.now())).length,
    handoffQueue: db.handoffQueue.length,
  });
}
