// GET /api/pilot — pilot rollout plan: branch ranking by NPA volume, A/B treatment-vs-control
// design, 8 go/no-go gates, projected lift, and the 4-phase rollout.

import { NextResponse } from "next/server";
import { pilotPlan } from "@/lib/pilot";

export async function GET() {
  return NextResponse.json(pilotPlan());
}
