// src/lib/twilio.ts — real Twilio dispatch (CLAUDE.md voice path). Activates when
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER are set; otherwise the
// caller falls back to simulated dispatch. VOICE LESSONS applied:
//   - TwiML uses ONLY <Play> (never <Say> — double voice with Polly)
//   - every URL/attr XML-escaped (unescaped & = "Application error… goodbye")
//   - production conversation runs over Media Streams (<Connect><Stream>, folder 06);
//     the smoke TwiML below just proves the trunk end-to-end.

import fs from "fs";
import path from "path";

export function twilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Smoke-test TwiML: play the greeting (pre-generated Sarvam TTS in production —
 *  GREETING_AUDIO_URL) then hang up. The full agent flow swaps this for
 *  <Connect><Stream url="wss://…"/> to the media-stream bridge. */
export function smokeTwiml(): string {
  const greeting = process.env.GREETING_AUDIO_URL;
  const media = process.env.MEDIA_STREAM_WSS; // wss://host/stream — folder 06 bridge
  if (media) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXml(media)}"/></Connect></Response>`;
  }
  if (greeting) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${escapeXml(greeting)}</Play><Pause length="1"/><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="2"/><Hangup/></Response>`;
}

/** Daypart by IST clock — drives the "good morning/afternoon/evening" audio variant. */
export function istDaypart(now = new Date()): "morning" | "afternoon" | "evening" {
  const istHour = (now.getUTCHours() + 5.5 + 24) % 24;
  return istHour < 12 ? "morning" : istHour < 17 ? "afternoon" : "evening";
}

/** Per-call TwiML: personalized ledger audio (name, EMI, days overdue, pending — generated
 *  by scripts/generate-call-audio.mjs, voice "Asha"/anushka) picked by loan + IST daypart;
 *  falls back to the generic greeting, then the silent smoke leg. */
export function callTwiml(loanId?: string): string {
  if (process.env.MEDIA_STREAM_WSS) return smokeTwiml(); // full media-stream agent wins when configured
  // Turn-by-turn conversation (Twilio <Gather> loop → Sarvam LLM/TTS). Needs a public APP_URL.
  const appUrl = process.env.APP_URL || "";
  if (process.env.CONVERSATION_MODE === "1" && loanId && appUrl.startsWith("https://")) {
    const action = escapeXml(`${appUrl}/api/voice/turn?loanId=${encodeURIComponent(loanId)}`);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${action}</Redirect></Response>`;
  }
  if (loanId) {
    const file = `call-${loanId}-${istDaypart()}.wav`;
    const local = path.resolve(process.cwd(), "public", "audio", file);
    const base = process.env.AUDIO_BASE_URL;
    if (base && fs.existsSync(local)) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${escapeXml(`${base}/${file}`)}</Play><Pause length="1"/><Hangup/></Response>`;
    }
  }
  return smokeTwiml();
}

/** Place a real PSTN call via the Twilio REST API. Uses inline TwiML so the smoke test
 *  needs no public webhook; when APP_URL is publicly reachable, a StatusCallback keeps
 *  the VoiceCall row in sync. Returns the provider Call SID. */
export async function placeTwilioCall(toPhone: string, loanId?: string): Promise<{ sid: string; status: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;
  const appUrl = process.env.APP_URL || "";

  const params = new URLSearchParams({ To: toPhone, From: from, Twiml: callTwiml(loanId) });
  if (appUrl.startsWith("https://")) {
    params.set("StatusCallback", `${appUrl}/api/voice/status`);
    params.set("StatusCallbackEvent", "completed");
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const text = await res.text();
  let body: { sid?: string; status?: string; message?: string };
  try { body = JSON.parse(text); } catch {
    // Non-JSON body = the request never reached Twilio (egress proxy / captive gateway).
    throw new Error(`Twilio dispatch blocked before reaching Twilio (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? "dispatch failed"}`);
  return { sid: body.sid!, status: body.status! };
}
