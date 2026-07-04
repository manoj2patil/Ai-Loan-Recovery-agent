// GET /api/metrics — Prometheus text exposition for the Grafana stack (Phase 5 infra).
// Gauges/counters are derived from the store; scrape-friendly, no auth (no PII in metrics).

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export async function GET() {
  const db = getDb();
  const day = Date.now() - 86400000;
  const recent = db.interactionLogs.filter((i) => Date.parse(i.createdAt) >= day);

  const gate: Record<string, number> = { ALLOW: 0, DEFER: 0, BLOCK: 0 };
  for (const i of recent) if (i.outcome.startsWith("GATE_")) gate[i.outcome.slice(5)] = (gate[i.outcome.slice(5)] ?? 0) + 1;

  const lines = [
    "# HELP sahayak_loans_total Loans in the book", "# TYPE sahayak_loans_total gauge",
    `sahayak_loans_total ${db.loans.length}`,
    "# HELP sahayak_overdue_loans Loans with DPD > 0", "# TYPE sahayak_overdue_loans gauge",
    `sahayak_overdue_loans ${db.loans.filter((l) => l.dpd > 0).length}`,
    "# HELP sahayak_gate_decisions_24h Gate verdicts in the last 24h", "# TYPE sahayak_gate_decisions_24h gauge",
    ...Object.entries(gate).map(([v, n]) => `sahayak_gate_decisions_24h{verdict="${v}"} ${n}`),
    "# HELP sahayak_payments_received_total Payment closure events", "# TYPE sahayak_payments_received_total counter",
    `sahayak_payments_received_total ${db.interactionLogs.filter((i) => i.outcome === "PAYMENT_RECEIVED").length}`,
    "# HELP sahayak_active_suppressions Active outreach suppressions", "# TYPE sahayak_active_suppressions gauge",
    `sahayak_active_suppressions ${db.suppressions.filter((s) => s.active && (!s.endsAt || Date.parse(s.endsAt) > Date.now())).length}`,
    "# HELP sahayak_handoff_queue Human handoff queue depth", "# TYPE sahayak_handoff_queue gauge",
    `sahayak_handoff_queue ${db.handoffQueue.length}`,
    "# HELP sahayak_uptime_seconds Process uptime", "# TYPE sahayak_uptime_seconds counter",
    `sahayak_uptime_seconds ${Math.round(process.uptime())}`,
  ];
  return new NextResponse(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
