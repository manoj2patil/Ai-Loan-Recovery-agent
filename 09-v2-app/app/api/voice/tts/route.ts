// GET /api/voice/tts?id=<key> — streams a cached Sarvam TTS clip (WAV) for Twilio <Play>.
// The turn webhook generates each reply's audio and stashes it; Twilio fetches it by id.

import { NextResponse } from "next/server";
import { getAudio } from "@/lib/audio-cache";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const buf = getAudio(id);
  if (!buf) return new NextResponse("not found", { status: 404 });
  return new NextResponse(buf as unknown as BodyInit, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
}
