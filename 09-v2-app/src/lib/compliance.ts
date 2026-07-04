// src/lib/compliance.ts — the Compliance Gate: every outreach (voice, whatsapp, sms, visit)
// is authorised here BEFORE it happens. Verdict ALLOW / DEFER / BLOCK with a full reason
// trail, logged for audit. Check order (per ROADMAP_V2 Phase 1):
//   1. hard suppression flags (deceased, bankruptcy, doNotCall)
//   2. active suppressions (e.g. just paid)
//   3. consent for the channel
//   4. ★ DND registry scrub  ← new v2 check, between consent and frequency-cap
//   5. frequency caps
//   6. calling hours (09:00–19:00 IST) for voice/visit
//
// Receipts/payment confirmations use intent="receipt": transactional messages the borrower
// expects; they skip the paid-suppression and frequency checks but still honour consent and
// hard suppression flags.

import { findCustomerById, activeSuppressions, recentInteractions, isOnInternalDnc, logInteraction } from "./db";
import { cfg } from "./config";

export type Channel = "voice" | "whatsapp" | "sms" | "visit";
export type Verdict = "ALLOW" | "DEFER" | "BLOCK";

export interface GateResult {
  verdict: Verdict;
  reasons: string[];          // full trail — every check that ran, pass or fail
  blockedBy?: string;         // the failing check when not ALLOW
}

/** Per-day caps come from SystemConfig (MAX_CALLS_PER_DAY=2, MAX_WHATSAPP_PER_DAY=3);
 *  visits stay capped at 1 per 7 days. */
function freqCap(channel: Channel): { max: number; days: number } {
  if (channel === "voice") return { max: cfg.maxCallsPerDay(), days: 1 };
  if (channel === "whatsapp" || channel === "sms") return { max: cfg.maxWhatsappPerDay(), days: 1 };
  return { max: 1, days: 7 };
}
const CHANNEL_LOG: Record<Channel, "VOICE" | "WHATSAPP" | "SMS" | "VISIT"> = {
  voice: "VOICE", whatsapp: "WHATSAPP", sms: "SMS", visit: "VISIT",
};

/** ★ DND registry scrub (Phase 1 v2). Wire the NCPR lookup to your telco/CPaaS; the internal
 *  do-not-contact list is checked here directly. */
export async function isOnDndRegistry(phone: string): Promise<boolean> {
  if (isOnInternalDnc(phone)) return true;
  // PRODUCTION: const ncpr = await telco.checkNcpr(phone); return ncpr.registered;
  return false;
}

export async function evaluateGate(opts: {
  customerId: string; channel: Channel; intent: "recovery" | "receipt";
}): Promise<GateResult> {
  const reasons: string[] = [];
  const done = (verdict: Verdict, blockedBy?: string): GateResult => {
    const result = { verdict, reasons, blockedBy };
    logInteraction({
      customerId: opts.customerId, channel: "SYSTEM", direction: "INTERNAL",
      outcome: `GATE_${verdict}`, gateVerdict: verdict,
      details: { channel: opts.channel, intent: opts.intent, reasons, blockedBy },
    });
    return result;
  };

  const customer = findCustomerById(opts.customerId);
  if (!customer) return done("BLOCK", "customer_not_found");

  // 1. hard suppression flags
  const f = customer.suppressionFlags;
  if (f.deceased) return done("BLOCK", "deceased");
  if (f.bankruptcyNotice) return done("BLOCK", "bankruptcy_notice");
  if (f.doNotCall && opts.channel === "voice") return done("BLOCK", "do_not_call_flag");
  reasons.push("suppression_flags: pass");

  // 2. active suppressions (recent payment etc.) — receipts are exempt
  if (opts.intent !== "receipt") {
    const sups = activeSuppressions(customer.id);
    if (sups.length > 0) return done("DEFER", `suppressed:${sups[0].reason}`);
    reasons.push("active_suppressions: none");
  } else {
    reasons.push("active_suppressions: skipped (receipt)");
  }

  // 3. consent for the channel
  const consent =
    opts.channel === "voice" || opts.channel === "visit"
      ? customer.consentVoice
      : opts.channel === "whatsapp"
        ? customer.consentWhatsapp
        : customer.consentSms;
  if (!consent?.granted) return done("BLOCK", `no_consent_${opts.channel}`);
  reasons.push(`consent_${opts.channel}: granted`);

  // 4. ★ DND registry scrub — recorded consent may override for account-servicing contact
  //    (transactional); configurable and OFF by default. Confirm policy with counsel.
  if (await isOnDndRegistry(customer.phone)) {
    const consentOverridesDnd = process.env.DND_CONSENT_OVERRIDE === "true";
    if (!consentOverridesDnd) return done("BLOCK", "dnd_registry");
    reasons.push("dnd_registry: listed, overridden by recorded consent");
  } else {
    reasons.push("dnd_registry: clear");
  }

  // 5. frequency caps (SystemConfig-driven) — receipts are exempt
  if (opts.intent !== "receipt") {
    const cap = freqCap(opts.channel);
    const sent = recentInteractions(customer.id, CHANNEL_LOG[opts.channel], cap.days).length;
    if (sent >= cap.max)
      return done("DEFER", `frequency_cap_${opts.channel}_${cap.days}d`);
    reasons.push(`frequency_cap: ${sent}/${cap.max} in ${cap.days}d`);
  } else {
    reasons.push("frequency_cap: skipped (receipt)");
  }

  // 6. calling hours (SystemConfig CALLING_HOURS_*, IST) for intrusive channels
  if (opts.channel === "voice" || opts.channel === "visit") {
    const start = cfg.callingHoursStart(); const end = cfg.callingHoursEnd();
    const istHour = (new Date().getUTCHours() + 5.5 + 24) % 24;
    if (istHour < start || istHour >= end) return done("DEFER", "outside_calling_hours_ist");
    reasons.push(`calling_hours_ist: within ${start}:00-${end}:00`);
  }

  return done("ALLOW");
}
