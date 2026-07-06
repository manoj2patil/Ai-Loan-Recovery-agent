// /api/voice/turn — the turn-by-turn conversation webhook (Twilio <Gather> speech loop).
// Twilio POSTs here each turn with the borrower's transcribed speech (SpeechResult); we run
// one LLM turn (Asha v2 + ledger facts), synthesize the reply with Sarvam TTS, and return
// TwiML that <Play>s the reply and <Gather>s the next borrower utterance — until a PTP is
// captured (link sent) or the turn cap is hit.
//
// Requires a PUBLIC APP_URL Twilio can reach (deploy, or a tunnel like cloudflared).
// Marathi note (VOICE LESSON): Twilio Gather ASR is weaker for Marathi than Sarvam saaras;
// hi/en are solid. For best-in-class Marathi ASR use the media-stream/Samvaad path.

import { NextResponse } from "next/server";
import { startConversation, handleTurn } from "@/lib/conversation";
import { tts, LANG_CODE } from "@/lib/sarvam";
import { putAudio } from "@/lib/audio-cache";
import { escapeXml } from "@/lib/twilio";

function xml(s: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${s}`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

async function speakAndGather(appUrl: string, loanId: string, callSid: string, text: string, lang: string, end: boolean) {
  const audioId = putAudio(await tts(text, lang));
  const playUrl = escapeXml(`${appUrl}/api/voice/tts?id=${audioId}`);
  if (end) {
    return xml(`<Response><Play>${playUrl}</Play><Pause length="1"/><Hangup/></Response>`);
  }
  const gatherLang = LANG_CODE[lang] || "hi-IN";
  const action = escapeXml(`${appUrl}/api/voice/turn?loanId=${encodeURIComponent(loanId)}`);
  // speechTimeout=auto lets Twilio detect end-of-speech (barge-in-ish); actionOnEmptyResult
  // re-prompts if the borrower stays silent.
  return xml(
    `<Response>` +
      `<Gather input="speech" language="${gatherLang}" speechTimeout="auto" ` +
      `actionOnEmptyResult="true" action="${action}" method="POST">` +
        `<Play>${playUrl}</Play>` +
      `</Gather>` +
      `<Redirect method="POST">${action}&amp;noinput=1</Redirect>` +
    `</Response>`,
  );
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const loanId = url.searchParams.get("loanId") || "";
  const appUrl = process.env.APP_URL || url.origin;

  let form: URLSearchParams;
  try { form = new URLSearchParams(await req.text()); } catch { form = new URLSearchParams(); }
  const callSid = form.get("CallSid") || url.searchParams.get("CallSid") || `web-${loanId}`;
  const speech = form.get("SpeechResult") || "";
  const noInput = url.searchParams.get("noinput") === "1";

  try {
    // First hit (Twilio's initial redirect into the conversation): open it.
    if (!speech && !noInput && !url.searchParams.get("started")) {
      const { text, language } = await startConversation(callSid, loanId);
      // mark started so a re-entry without speech doesn't re-open
      const started = new URL(url); started.searchParams.set("started", "1");
      return await speakAndGather(appUrl, loanId, callSid, text, language, false);
    }
    // Borrower said nothing — gentle re-prompt, one line.
    if (!speech) {
      const { text, language, end } = await handleTurn(callSid, "(no response)");
      return await speakAndGather(appUrl, loanId, callSid, text, language, end);
    }
    const { text, language, end } = await handleTurn(callSid, speech);
    return await speakAndGather(appUrl, loanId, callSid, text, language, end);
  } catch (e) {
    // Never leave the caller hanging — say a graceful fallback and end.
    const msg = e instanceof Error ? e.message : "error";
    return xml(`<Response><Say>Sorry, we are unable to continue. Our team will call you back.</Say><Hangup/></Response>` +
      `<!-- ${escapeXml(msg)} -->`);
  }
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
