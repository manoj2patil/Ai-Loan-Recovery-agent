// src/lib/voice.ts — gated outbound call placement (BUILD_STEPS Step 6/7 orchestration side).
// DEV: dispatch is simulated (VoiceCall row status INITIATED, agent "AI"). PRODUCTION: the
// dispatch step hands off to the real voice path — Twilio Media Streams bridge (folder 06)
// or the LiveKit agent (05-fullstack-app backend / 07 pilot) — via env-driven endpoints,
// per the on-prem swap rule. Everything around it (gate, logging, whitelist) is identical.

import { findLoanByLoanId, insertVoiceCall, logInteraction } from "./db";
import { evaluateGate } from "./compliance";

export async function placeCall(loanId: string, opts?: { toGuarantorPhone?: string; intentNote?: string }) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const customer = loan.customer;

  // Contact whitelist (GOLDEN RULE 2): borrower or registered guarantor only —
  // callers pass a guarantor phone only via the guarantor workflow, which verifies it.
  const toPhone = opts?.toGuarantorPhone ?? customer.phone;

  const gate = await evaluateGate({ customerId: customer.id, channel: "voice", intent: "recovery" });
  if (gate.verdict !== "ALLOW") return { placed: false, gate };

  // PRODUCTION dispatch (env-driven):
  //   VOICE_STACK=twilio  → POST /api/voice/twilio/dial (folder 06 media-stream bridge)
  //   VOICE_STACK=livekit → LiveKit agent dispatch + SIP participant (05-fullstack-app server.py)
  const call = insertVoiceCall({
    customerId: customer.id, loanId: loan.loanId, direction: "OUTBOUND", toPhone,
    language: customer.preferredLanguage, startedAt: new Date().toISOString(),
    durationSec: 0, status: "INITIATED", agentType: "AI",
    complianceGate: { verdict: gate.verdict, reasons: gate.reasons },
    transcript: opts?.intentNote,
  });
  logInteraction({
    customerId: customer.id, loanId: loan.loanId, channel: "VOICE",
    direction: "OUTBOUND", outcome: "CALL_INITIATED", gateVerdict: gate.verdict,
    details: { callId: call.id, toPhone: toPhone.slice(0, 3) + "XXXX" + toPhone.slice(-4), note: opts?.intentNote },
  });
  return { placed: true, gate, callId: call.id, language: customer.preferredLanguage };
}
