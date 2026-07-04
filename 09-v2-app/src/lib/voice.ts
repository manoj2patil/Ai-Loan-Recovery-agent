// src/lib/voice.ts — gated outbound call placement (BUILD_STEPS Step 6/7 orchestration side).
// Dispatch is env-driven per the on-prem swap rule:
//   TWILIO_* set        → REAL PSTN call via the Twilio REST API (src/lib/twilio.ts);
//                         the conversation leg upgrades to Media Streams (folder 06) or
//                         the LiveKit agent (05/07) via MEDIA_STREAM_WSS.
//   TWILIO_* unset (dev) → simulated dispatch (VoiceCall row only).
// Everything around dispatch (gate, whitelist, logging) is identical in both modes.

import { findLoanByLoanId, insertVoiceCall, logInteraction } from "./db";
import { getDb, persist } from "./store";
import { evaluateGate } from "./compliance";
import { twilioConfigured, placeTwilioCall } from "./twilio";

export async function placeCall(loanId: string, opts?: { toGuarantorPhone?: string; intentNote?: string }) {
  const loan = findLoanByLoanId(loanId);
  if (!loan) throw new Error("loan not found");
  const customer = loan.customer;

  // Contact whitelist (GOLDEN RULE 2): borrower or registered guarantor only —
  // callers pass a guarantor phone only via the guarantor workflow, which verifies it.
  const toPhone = opts?.toGuarantorPhone ?? customer.phone;

  const gate = await evaluateGate({ customerId: customer.id, channel: "voice", intent: "recovery" });
  if (gate.verdict !== "ALLOW") return { placed: false, gate };

  let providerSid: string | undefined;
  let dispatch: "twilio" | "simulated" = "simulated";
  if (twilioConfigured()) {
    const t = await placeTwilioCall(toPhone); // throws on Twilio rejection — surfaced to caller
    providerSid = t.sid;
    dispatch = "twilio";
  }

  const call = insertVoiceCall({
    customerId: customer.id, loanId: loan.loanId, direction: "OUTBOUND", toPhone,
    language: customer.preferredLanguage, startedAt: new Date().toISOString(),
    durationSec: 0, status: "INITIATED", agentType: "AI",
    complianceGate: { verdict: gate.verdict, reasons: gate.reasons },
    transcript: opts?.intentNote, providerSid,
  });
  logInteraction({
    customerId: customer.id, loanId: loan.loanId, channel: "VOICE",
    direction: "OUTBOUND", outcome: "CALL_INITIATED", gateVerdict: gate.verdict,
    details: {
      callId: call.id, dispatch, providerSid,
      toPhone: toPhone.slice(0, 3) + "XXXX" + toPhone.slice(-4), note: opts?.intentNote,
    },
  });
  return { placed: true, gate, callId: call.id, language: customer.preferredLanguage, dispatch, providerSid };
}

/** Status callback (Twilio StatusCallback) → close out the VoiceCall row. */
export function updateCallStatus(providerSid: string, status: string, durationSec: number) {
  const db = getDb();
  const call = db.voiceCalls.find((v) => v.providerSid === providerSid);
  if (!call) return false;
  call.status = status === "completed" ? "COMPLETED" : "NO_ANSWER";
  call.durationSec = durationSec;
  call.endedAt = new Date().toISOString();
  persist();
  logInteraction({
    customerId: call.customerId, loanId: call.loanId, channel: "SYSTEM",
    direction: "INTERNAL", outcome: "CALL_STATUS",
    details: { providerSid, status, durationSec },
  });
  return true;
}
