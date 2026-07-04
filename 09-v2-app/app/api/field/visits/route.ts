// GET  /api/field/visits — visits list (PII-masked); ?agentId=&lat=&lng= returns the
//                          agent's day route, nearest-neighbour ordered.
// POST /api/field/visits — { action: "schedule" | "complete", ... }
// Scheduling passes the Compliance Gate (channel "visit") first; completion requires a
// geo-tag, and cash requires a receiptRef. All writes RBAC-guarded and audit-logged.

import { NextResponse } from "next/server";
import { scheduleVisit, completeVisit, listVisits, orderRoute } from "@/lib/field-visits";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  const lat = url.searchParams.get("lat"); const lng = url.searchParams.get("lng");
  let visits = listVisits();
  if (agentId) visits = visits.filter((v) => v.agentId === agentId);
  if (agentId && lat && lng)
    visits = orderRoute(visits, { lat: Number(lat), lng: Number(lng) });
  return NextResponse.json({ visits });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "schedule") {
      const actor = requireRole(req, "officer");
      const { gate, visit } = await scheduleVisit({
        loanId: body.loanId, agentId: body.agentId,
        scheduledFor: body.scheduledFor, address: body.address,
        lat: body.lat, lng: body.lng,
      });
      if (!visit)
        return NextResponse.json({ ok: false, gate }, { status: 409 });
      writeAudit({ actor: actor.name, role: actor.role, action: "VISIT_SCHEDULE",
        entity: "FieldVisit", entityId: visit.id, details: { loanId: body.loanId, gate: gate.verdict } });
      return NextResponse.json({ ok: true, visit, gate });
    }

    if (body.action === "complete") {
      const actor = requireRole(req, "officer");
      const visit = await completeVisit(body.visitId, {
        outcome: body.outcome, note: body.note, lat: body.lat, lng: body.lng,
        amountCollected: body.amountCollected, receiptRef: body.receiptRef,
        photoRefs: body.photoRefs,
      });
      writeAudit({ actor: actor.name, role: actor.role, action: "VISIT_COMPLETE",
        entity: "FieldVisit", entityId: visit.id,
        details: { outcome: body.outcome, amountCollected: body.amountCollected, receiptRef: body.receiptRef } });
      return NextResponse.json({ ok: true, visit });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
