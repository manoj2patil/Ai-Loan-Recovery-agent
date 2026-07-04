// POST /api/payments/otp — OTP-verified on-call payment confirmation (Phase 3 ★).
// { action: "request", linkId } → sends OTP to the registered number (dev returns devCode)
// { action: "verify", linkId, code } → logs ON_CALL_CONFIRMATION_OTP_VERIFIED on success

import { NextResponse } from "next/server";
import { requestOnCallOtp, verifyOnCallOtp } from "@/lib/payments";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "officer");
    const body = await req.json();

    if (body.action === "request") {
      const res = requestOnCallOtp(body.linkId);
      writeAudit({ actor: actor.name, role: actor.role, action: "OTP_REQUEST",
        entity: "PaymentLink", entityId: body.linkId });
      return NextResponse.json({ ok: true, ...res });
    }

    if (body.action === "verify") {
      const res = verifyOnCallOtp(body.linkId, String(body.code ?? ""));
      writeAudit({ actor: actor.name, role: actor.role, action: "OTP_VERIFY",
        entity: "PaymentLink", entityId: body.linkId, details: res });
      return NextResponse.json({ ok: res.verified, ...res }, { status: res.verified ? 200 : 400 });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
