// GET/POST /api/voice/twiml — TwiML for inbound legs / webhook-configured calls.
// <Play>-only per the VOICE LESSONS (never <Say>); upgrades to <Connect><Stream> when the
// folder-06 media-stream bridge is configured (MEDIA_STREAM_WSS).

import { NextResponse } from "next/server";
import { smokeTwiml } from "@/lib/twilio";

function twiml() {
  return new NextResponse(smokeTwiml(), { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export async function GET() { return twiml(); }
export async function POST() { return twiml(); }
