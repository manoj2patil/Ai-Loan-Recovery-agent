// inbound-route.ts — NEW, ADDITIVE TwiML route. Does NOT replace your existing route.
// Next.js App Router: app/api/voice/inbound-stream/route.ts
//
// When USE_MEDIA_STREAMS is on (globally or for a test number), connect the call to the
// real-time media server. Otherwise, DELEGATE to your existing <Record> TwiML unchanged.

export const dynamic = "force-dynamic";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function POST(req: Request) {
  const form = await req.formData();
  const to = String(form.get("To") ?? "");
  const from = String(form.get("From") ?? "");
  const phone = to || from;

  const flagOn = process.env.USE_MEDIA_STREAMS === "true";
  // Optional: only route a specific test number through the new path.
  const testNumbers = (process.env.MEDIA_STREAM_TEST_NUMBERS || "").split(",");
  const useStream = flagOn || testNumbers.includes(phone);

  if (!useStream) {
    // FALLBACK: keep the existing behaviour untouched.
    // Return your current <Record> TwiML here (import/call your existing handler).
    return existingRecordTwiml(req);
  }

  // Look up the borrower so the greeting is personalized and in their language.
  // PRODUCTION: const b = await lookupBorrower(phone);
  const b = { name: "", language: "hi-IN", bank: process.env.BANK_NAME || "your bank" };
  const host = process.env.MEDIA_HOST || "wss://media.YOUR_DOMAIN:3001";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(host)}/media">
      <Parameter name="phone" value="${escapeXml(phone)}" />
      <Parameter name="lang" value="${escapeXml(b.language)}" />
      <Parameter name="name" value="${escapeXml(b.name)}" />
      <Parameter name="bank" value="${escapeXml(b.bank)}" />
    </Stream>
  </Connect>
</Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

// Replace this with a call to your EXISTING record-based TwiML handler.
async function existingRecordTwiml(_req: Request): Promise<Response> {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><!-- delegate to your existing /api/voice/twiml/start flow --></Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
