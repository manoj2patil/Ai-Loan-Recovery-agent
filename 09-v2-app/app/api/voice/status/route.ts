// POST /api/voice/status — Twilio StatusCallback: closes out the VoiceCall row
// (COMPLETED/NO_ANSWER + duration). Twilio posts application/x-www-form-urlencoded.
// PRODUCTION: validate the X-Twilio-Signature header against TWILIO_AUTH_TOKEN.

import { NextResponse } from "next/server";
import { updateCallStatus } from "@/lib/voice";

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const sid = form.get("CallSid") ?? "";
  const status = form.get("CallStatus") ?? "unknown";
  const duration = Number(form.get("CallDuration") ?? 0);
  const matched = updateCallStatus(sid, status, duration);
  return NextResponse.json({ ok: true, matched });
}
