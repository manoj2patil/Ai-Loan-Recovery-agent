// app/api/voice/inbound/route.ts — TwiML webhook for inbound/connected calls.
// PRODUCTION: connect the call to the Media Streams WS (real-time, ~1–2s).
// Reference skeleton for Claude Code.
//
// LESSONS:
//  - Always escapeXml() any URL/value placed in TwiML (& → &amp;) or Twilio errors with
//    "Application error... goodbye".
//  - Pass borrower phone + language to the stream via <Parameter> so the WS can look them up.
//  - Do NOT use <Say> (Polly) anywhere — the Media Streams TTS is Sarvam only.

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: Request) {
  const form = await req.formData();
  const fromOrTo = String(form.get("To") ?? form.get("From") ?? "");
  // TODO: lookupBorrower(fromOrTo) → preferred language; default hi-IN.
  const lang = "hi-IN";

  const wssUrl = process.env.TWILIO_MEDIA_STREAM_WSS ?? "wss://media.YOUR_DOMAIN:3001";

  // Connect the call's audio to our Bun WS bridge; pass params the bridge needs.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wssUrl)}">
      <Parameter name="phone" value="${escapeXml(fromOrTo)}" />
      <Parameter name="lang" value="${escapeXml(lang)}" />
    </Stream>
  </Connect>
</Response>`;

  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

// ----------------------------------------------------------------------------
// MVP FALLBACK (no Media Streams): <Record>-based loop. Use only to prove the
// pipeline; it is ~4–5s/turn. Pattern:
//   /api/voice/twiml/start      → <Play greeting/> <Record action=/transcribe/>
//   /api/voice/twiml/transcribe → download recording → Sarvam ASR → LLM → TTS
//                                → <Play reply/> <Record .../>  (loop)
// RULES for the fallback:
//   - ONLY <Play> (Sarvam TTS). NEVER <Say> (double voice).
//   - escapeXml() every action URL.
//   - Do NOT use <Gather> ASR for Indic (it hallucinates Hindi for Marathi). Use <Record>.
