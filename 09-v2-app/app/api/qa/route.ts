// GET /api/qa — call-QA scorecard + hallucination flags (compliance role: it names calls
// that failed conduct checks, which is review-sensitive).

import { NextResponse } from "next/server";
import { qaSummary } from "@/lib/qa";
import { requireRole, HttpError } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    requireRole(req, "compliance");
    return NextResponse.json(qaSummary());
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
