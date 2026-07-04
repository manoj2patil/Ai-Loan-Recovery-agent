// GET /api/health — liveness/readiness for the LB and K8s probes. No auth (no data).

import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export async function GET() {
  try {
    const db = getDb();
    return NextResponse.json({
      ok: true,
      store: { customers: db.customers.length, loans: db.loans.length },
      encryptionAtRest: !!process.env.STORE_ENCRYPTION_KEY,
      authMode: process.env.AUTH_MODE === "session" ? "session" : "header",
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "store unavailable" }, { status: 503 });
  }
}
