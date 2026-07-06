// GET /api/callbacks — scheduled callbacks the borrower asked for (busy / meeting / "call me
// tomorrow at 3"). The dialer/cron picks up PENDING ones at their time, re-gated. PII-masked.

import { NextResponse } from "next/server";
import { listCallbacks, findCustomerById } from "@/lib/db";
import { maskName } from "@/lib/audit";

export async function GET() {
  const rows = listCallbacks()
    .slice()
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
    .map((c) => ({
      loanId: c.loanId, borrower: maskName(findCustomerById(c.customerId)?.name ?? "—"),
      scheduledFor: c.scheduledFor, reason: c.reason, status: c.status,
    }));
  return NextResponse.json({ callbacks: rows });
}
