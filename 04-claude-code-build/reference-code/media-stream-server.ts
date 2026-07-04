// scripts/media-stream-server.ts — Bun WebSocket bridge for Twilio Media Streams (port 3001)
// THIS IS THE LATENCY FIX. The <Record> loop is ~4–5s/turn; this real-time bridge is ~1–2s.
// Reference skeleton for Claude Code — fill TODOs, add robust error handling + tests.
//
// Flow: Twilio (8kHz μ-law WS) → decode μ-law→16kHz PCM → Sarvam ASR (streaming) → transcript
//       → LLM (streaming) → TTS (μ-law 8kHz) → frames back to Twilio. Barge-in supported.

import { asrStreamUrl, llmReply, ttsSynthesize } from "../lib/sarvam";
// import { evaluateGate } from "../lib/compliance-gate"; // gate runs BEFORE dial, not here
// import { lookupBorrower } from "../lib/data";           // borrower facts for context

const PORT = Number(process.env.MEDIA_STREAM_PORT ?? 3001);

// ---- μ-law <-> PCM (8kHz μ-law is what Twilio sends/expects) -------------
function muLawDecode(u8: Uint8Array): Int16Array {
  // TODO: standard G.711 μ-law → 16-bit PCM. Then upsample 8k→16k for ASR.
  return new Int16Array(u8.length);
}
function muLawEncode(pcm16: Int16Array): Uint8Array {
  // TODO: 16-bit PCM (downsample 16k→8k) → G.711 μ-law for Twilio.
  return new Uint8Array(pcm16.length);
}

interface CallState {
  streamSid?: string;
  borrowerPhone?: string;
  language: string;
  history: { role: "user" | "assistant"; content: string }[];
  speaking: boolean;     // true while we are playing TTS (for barge-in)
  asr?: WebSocket;       // streaming ASR socket
}

Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return; // upgrade Twilio WS
    return new Response("media-stream-server up", { status: 200 });
  },
  websocket: {
    open(ws) {
      (ws as any).state = {
        language: "hi-IN",
        history: [],
        speaking: false,
      } as CallState;
    },

    async message(ws, raw) {
      const state = (ws as any).state as CallState;
      const msg = JSON.parse(String(raw));

      switch (msg.event) {
        case "start": {
          state.streamSid = msg.start.streamSid;
          // Twilio passes custom params on <Stream><Parameter>; read borrower phone/lang here.
          state.borrowerPhone = msg.start.customParameters?.phone;
          state.language = msg.start.customParameters?.lang ?? "hi-IN";
          // TODO: lookupBorrower(state.borrowerPhone) → inject loan facts into system prompt.

          // Open streaming ASR socket (self-hosted :8002). For cloud, buffer + REST instead.
          const asrUrl = asrStreamUrl();
          if (asrUrl) {
            state.asr = new WebSocket(asrUrl);
            state.asr.onmessage = (ev) => onTranscript(ws, state, JSON.parse(String(ev.data)));
          }

          // Phase A: speak the SCRIPTED disclosure immediately (cached TTS).
          await speak(ws, state, disclosureLine(state.language), /*scripted*/ true);
          break;
        }

        case "media": {
          // Inbound borrower audio (base64 μ-law). Decode and forward to ASR.
          const muLaw = Buffer.from(msg.media.payload, "base64");
          const pcm16 = muLawDecode(new Uint8Array(muLaw)); // + upsample 8k→16k (TODO)

          // BARGE-IN: if we're speaking and the borrower starts talking, stop our TTS.
          if (state.speaking && energy(pcm16) > BARGE_IN_THRESHOLD) {
            stopSpeaking(ws, state);
          }

          if (state.asr && state.asr.readyState === WebSocket.OPEN) {
            state.asr.send(pcm16.buffer); // raw 16kHz PCM frames
          }
          break;
        }

        case "stop":
          state.asr?.close();
          break;
      }
    },

    close(ws) {
      const state = (ws as any).state as CallState;
      state.asr?.close();
      // TODO: persist VoiceCall + InteractionLog (outcome, transcript, recordingUrl, gate).
    },
  },
});

const BARGE_IN_THRESHOLD = 500; // tune
function energy(pcm: Int16Array) { let s = 0; for (const v of pcm) s += Math.abs(v); return s / (pcm.length || 1); }

// On a FINAL transcript: run the LLM, then speak the reply.
async function onTranscript(ws: any, state: CallState, t: { text: string; final: boolean; language?: string }) {
  if (!t.final || !t.text.trim()) return;
  if (t.language && t.language !== state.language) state.language = t.language; // auto language switch
  state.history.push({ role: "user", content: t.text });

  const reply = await llmReply({
    system: buildSystemPrompt(state),   // includes scope rules + ledger facts (TODO inject)
    messages: state.history,
    stream: true,                       // start TTS on first clause for low latency
  });
  state.history.push({ role: "assistant", content: reply });
  await speak(ws, state, reply, false);
}

// Synthesize μ-law @ 8kHz and stream frames back to Twilio.
async function speak(ws: any, state: CallState, text: string, scripted: boolean) {
  state.speaking = true;
  const audio = await ttsSynthesize({
    text,
    language: state.language as any,
    voice: "anushka",   // female persona (LESSON: meera deprecated)
    sampleRate: 8000,   // Media Streams μ-law
  });
  const muLaw = muLawEncode(new Int16Array(audio.buffer)); // + downsample 16k→8k (TODO)
  // Twilio expects 20ms frames (160 bytes @ 8kHz μ-law). Chunk and send as 'media' events.
  for (let i = 0; i < muLaw.length && state.speaking; i += 160) {
    ws.send(JSON.stringify({
      event: "media",
      streamSid: state.streamSid,
      media: { payload: Buffer.from(muLaw.slice(i, i + 160)).toString("base64") },
    }));
    await Bun.sleep(20);
  }
  state.speaking = false;
}

function stopSpeaking(ws: any, state: CallState) {
  state.speaking = false;
  // Twilio 'clear' empties the playback buffer immediately (true barge-in).
  ws.send(JSON.stringify({ event: "clear", streamSid: state.streamSid }));
}

// TODO: move these into shared lib (templates by language + injected loan facts).
function disclosureLine(lang: string) {
  return lang.startsWith("mr")
    ? "नमस्कार, मी 'आशा', तुमच्या कर्ज खात्याबद्दल बोलत आहे. हा कॉल रेकॉर्ड होत आहे..."
    : "नमस्ते, मैं 'आशा', आपके लोन खाते के बारे में बात कर रही हूँ। यह कॉल रिकॉर्ड हो रही है...";
}
function buildSystemPrompt(_state: CallState) {
  return "You are Asha... [inject scope rules + ledger loan facts; figures from DB only]";
}

console.log(`media-stream-server on :${PORT}`);
