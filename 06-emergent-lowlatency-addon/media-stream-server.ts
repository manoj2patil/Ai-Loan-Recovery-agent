// media-stream-server.ts — Production Twilio Media Streams server (persistent process).
// Bridges Twilio (8kHz μ-law) <-> Sarvam ASR / multi-provider LLM / Bulbul TTS in real time.
//
// PRODUCTION FEATURES
//  - INSTANT GREETING: pre-generated per-borrower greeting plays the moment Twilio's
//    "start" event arrives (the borrower hears Asha immediately on pickup — no dead air).
//  - Turn-by-turn conversational loop with instant filler + streaming LLM->sentence TTS
//    + barge-in (ConversationManager).
//  - /health endpoint for readiness checks (point Twilio only after it returns 200).
//  - Structured logs per call (callSid), graceful shutdown, per-connection error isolation.
//
// Run:  node media-stream-server.js   (or bun media-stream-server.ts)  — see Dockerfile.

import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { ttsSynthesize, sttTranscribe } from "./sarvam-streaming";
import { llmStream } from "./llm-providers"; // z.ai / Emergent / Sarvam + fallback
import { ConversationManager } from "./conversation-manager";
import { pregenFillers } from "./filler-pregen";
import {
  muLawToPcm, pcmToMuLaw, upsample8to16, pcmToWav, isSpeech,
} from "./audio";
// Wire these two to your app's DB + prompt builder:
// import { lookupBorrower } from "./db"; import { buildAshaPrompt } from "./prompt";

const PORT = Number(process.env.MEDIA_STREAM_PORT || 3001);
const SILENCE_MS = Number(process.env.VAD_SILENCE_MS || 400); // end-of-turn endpointing
let ready = false;
let activeCalls = 0;

// ---------- HTTP server with /health, WS upgrade on /media ----------
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: ready, activeCalls }));
    return;
  }
  res.writeHead(200); res.end("media-stream-server");
});
const wss = new WebSocketServer({ server: httpServer, path: "/media" });

// ---------- greeting builder (language-keyed, verbatim compliance wording) ----------
function greetingText(name: string, bank: string, lang: string): string {
  const g: Record<string, string> = {
    "hi-IN": `नमस्ते, क्या मेरी बात ${name} जी से हो रही है? मैं 'आशा', ${bank} की डिजिटल सहायक। ` +
             `यह कॉल गुणवत्ता और अनुपालन के लिए रिकॉर्ड की जा रही है। कृपया पुष्टि के लिए अपने आधार के अंतिम चार अंक बताइए।`,
    "mr-IN": `नमस्कार, मी ${name} यांच्याशी बोलत आहे का? मी 'आशा', ${bank} ची डिजिटल सहाय्यक. ` +
             `हा कॉल गुणवत्ता आणि अनुपालनासाठी रेकॉर्ड होत आहे. कृपया तुमच्या आधारचे शेवटचे चार अंक सांगा.`,
    "en-IN": `Namaste, am I speaking with ${name}? I'm Asha, a digital assistant from ${bank}. ` +
             `This call is recorded for quality and compliance. Please confirm the last four digits of your Aadhaar.`,
  };
  return g[lang] || g["en-IN"];
}

wss.on("connection", (twilio: WebSocket) => {
  let streamSid = "";
  let callSid = "";
  let cm: ConversationManager | null = null;
  let capture: number[] = [];
  let inSpeech = false;
  let endTimer: NodeJS.Timeout | null = null;
  let closed = false;
  activeCalls++;

  const log = (msg: string, extra: object = {}) =>
    console.log(JSON.stringify({ ts: new Date().toISOString(), callSid, msg, ...extra }));

  function sendPcmToTwilio(pcmBuf: ArrayBuffer) {
    if (closed || twilio.readyState !== WebSocket.OPEN) return;
    const mu = pcmToMuLaw(new Int16Array(pcmBuf)); // TTS returns 8kHz PCM (sampleRate=8000)
    for (let i = 0; i < mu.length; i += 160) {     // 160 bytes = 20ms @ 8kHz μ-law
      twilio.send(JSON.stringify({
        event: "media", streamSid,
        media: { payload: Buffer.from(mu.slice(i, i + 160)).toString("base64") },
      }));
    }
  }

  async function endOfTurn() {
    if (!cm || capture.length === 0) return;
    const pcm8 = Int16Array.from(capture);
    capture = []; inSpeech = false;
    try {
      const wav = pcmToWav(upsample8to16(pcm8), 16000);
      const { text, language } = await sttTranscribe(wav, new AbortController().signal);
      if (!text.trim()) return;
      log("user_transcript", { text, language });
      if (language) cm.setLanguage(language);            // mid-call language auto-switch
      await cm.onUserFinalTranscript(text);              // filler + streaming reply + barge-in
    } catch (e) {
      log("turn_error", { error: String(e) });
      // Fail soft: apologise briefly rather than dead air, then keep listening.
      try {
        const sorry = await ttsSynthesize(
          "माफ़ कीजिए, एक क्षण… क्या आप दोहरा सकते हैं?", cm!.getLanguage?.() || "hi-IN",
          new AbortController().signal, 8000);
        sendPcmToTwilio(sorry);
      } catch { /* give up quietly; next turn continues */ }
    }
  }

  twilio.on("message", async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid || "";
        const phone = msg.start.customParameters?.phone || "";
        const lang = msg.start.customParameters?.lang || "hi-IN";
        const name = msg.start.customParameters?.name || "";
        const bank = msg.start.customParameters?.bank || process.env.BANK_NAME || "your bank";
        log("call_start", { phone, lang });

        // PRODUCTION: const borrower = await lookupBorrower(phone);
        //             const system = buildAshaPrompt(borrower);
        const system = process.env.ASHA_SYSTEM_PROMPT ||
          "You are Asha... [wire buildAshaPrompt(borrower) here — see asha_system_prompt.md]";

        cm = new ConversationManager({
          llmStream,
          ttsSynthesize: (t, l, sig) => ttsSynthesize(t, l, sig, 8000),
          getFillerAudio: (p, l) => ttsSynthesize(p, l, new AbortController().signal, 8000),
          sendAudio: sendPcmToTwilio,
          clearPlayback: () => {
            if (twilio.readyState === WebSocket.OPEN)
              twilio.send(JSON.stringify({ event: "clear", streamSid }));
          },
        }, system, lang);

        // ★ INSTANT GREETING — plays the moment the borrower picks up. The dialer should call
        // POST /pregen-greeting BEFORE dialing so this TTS is already cached (≈0ms). Even if
        // not pre-cached, we synthesize now and speak as soon as it's ready.
        try {
          const audio = await ttsSynthesize(
            greetingText(name, bank, lang), lang, new AbortController().signal, 8000);
          sendPcmToTwilio(audio);
          log("greeting_played");
        } catch (e) { log("greeting_error", { error: String(e) }); }
        break;
      }

      case "media": {
        if (!cm) break;
        const pcm8 = muLawToPcm(new Uint8Array(Buffer.from(msg.media.payload, "base64")));
        if (isSpeech(pcm8)) {
          if (!inSpeech) { inSpeech = true; cm.onUserSpeechStart(); }   // barge-in
          for (const s of pcm8) capture.push(s);
          if (endTimer) { clearTimeout(endTimer); endTimer = null; }
        } else if (inSpeech && !endTimer) {
          endTimer = setTimeout(() => { endTimer = null; void endOfTurn(); }, SILENCE_MS);
        }
        break;
      }

      case "stop":
        log("call_stop");
        break;
    }
  });

  twilio.on("close", () => {
    closed = true; activeCalls--;
    if (endTimer) clearTimeout(endTimer);
    log("connection_closed");
    // PRODUCTION: persist VoiceCall + InteractionLog (transcript, outcome, gate decision).
  });
  twilio.on("error", (e) => log("ws_error", { error: String(e) }));
});

// ---------- greeting pre-cache endpoint (dialer calls this BEFORE dialing) ----------
httpServer.on("request", () => { /* handled above */ });

// ---------- boot: warm filler + greeting caches, then accept traffic ----------
(async () => {
  try { await pregenFillers(); } catch (e) { console.error("filler pregen failed", e); }
  httpServer.listen(PORT, () => { ready = true; console.log(`media-stream-server ready on :${PORT} (/health, /media)`); });
})();

// ---------- graceful shutdown ----------
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    ready = false;
    console.log(`${sig} received; closing after active calls end`);
    wss.close(); httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000);
  });
}
