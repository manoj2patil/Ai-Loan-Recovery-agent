// conversation-manager.ts — Low-latency, continuous, turn-by-turn conversation manager.
//
// The whole point: NEVER wait for one stage to finish before starting the next, and MASK the
// unavoidable LLM latency with an instant filler. Techniques implemented here:
//   1. Instant filler on end-of-turn (cached audio) while the LLM thinks   → hides ~500-900ms
//   2. Streaming LLM → sentence-by-sentence TTS (speak sentence 1 while writing sentence 2)
//   3. Barge-in: user speaks over agent → stop playback + cancel in-flight LLM/TTS instantly
//   4. Persistent ASR/LLM/TTS clients (opened once per call, reused every turn)
//
// This module is transport-agnostic. Wire the 4 I/O hooks (below) to your Twilio Media Streams
// server (8kHz μ-law) or LiveKit session. Audio buffers here are PCM/opaque — convert at the edge.

import fillersData from "./fillers.json";

type Lang = string;

// ---- Injected dependencies (implement these against your stack) -----------
export interface Deps {
  // Streaming LLM: yields text tokens/chunks. Must be abortable via the signal.
  llmStream(system: string, history: Msg[], user: string, signal: AbortSignal): AsyncIterable<string>;
  // TTS one chunk of text → audio (cache internally by text+lang+voice).
  ttsSynthesize(text: string, lang: Lang, signal: AbortSignal): Promise<ArrayBuffer>;
  // Pre-cached filler audio (generated once at startup). Returns audio for a phrase.
  getFillerAudio(phrase: string, lang: Lang): Promise<ArrayBuffer>;
  // Send audio to the caller (enqueue for playback).
  sendAudio(audio: ArrayBuffer): void;
  // Immediately stop/flush the caller's playback buffer (Twilio "clear"). For barge-in.
  clearPlayback(): void;
}

export interface Msg { role: "user" | "assistant"; content: string }

const NEUTRAL = (fillersData as any).neutral as Record<Lang, string[]>;
const EMPATHETIC = (fillersData as any).empathetic as Record<Lang, string[]>;
const pick = (arr?: string[]) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : "");

// Split streamed text into speakable sentences as soon as a boundary appears.
function* sentences(buffer: { text: string }, chunk: string): Generator<string> {
  buffer.text += chunk;
  // Boundary on . ? ! or Devanagari danda ।  (keep it simple; tune as needed)
  const re = /[^.?!।]+[.?!।]+/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(buffer.text))) {
    yield m[0].trim();
    lastIndex = re.lastIndex;
  }
  buffer.text = buffer.text.slice(lastIndex); // keep the unfinished tail
}

export class ConversationManager {
  private history: Msg[] = [];
  private lang: Lang = "hi-IN";
  private speaking = false;
  private turnAbort: AbortController | null = null;

  constructor(private deps: Deps, private system: string, initialLang: Lang = "hi-IN") {
    this.lang = initialLang;
  }

  setLanguage(l: Lang) { this.lang = l; }
  getLanguage(): Lang { return this.lang; }

  /** Call this the INSTANT the user starts speaking (VAD speech-start). Enables barge-in. */
  onUserSpeechStart() {
    if (this.speaking) {
      this.deps.clearPlayback();      // stop the agent's audio immediately
      this.turnAbort?.abort();        // cancel in-flight LLM + TTS
      this.speaking = false;
    }
  }

  /** Call this on FINAL transcript (VAD end-of-turn). Drives the low-latency reply. */
  async onUserFinalTranscript(text: string, opts?: { sentiment?: "neutral" | "distress" }) {
    if (!text.trim()) return;
    this.history.push({ role: "user", content: text });

    // (1) INSTANT FILLER — play a cached ack NOW, before the LLM even responds.
    //     This is the single biggest perceived-latency win.
    const pool = opts?.sentiment === "distress" ? EMPATHETIC[this.lang] : NEUTRAL[this.lang];
    const filler = pick(pool);
    if (filler) {
      this.deps.getFillerAudio(filler, this.lang).then((a) => this.deps.sendAudio(a)).catch(() => {});
    }

    // (2) STREAM LLM → sentence-by-sentence TTS. Speak sentence 1 while LLM writes sentence 2.
    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    this.speaking = true;

    // --- latency instrumentation (for A/B across LLM providers) ---
    const t0 = Date.now();          // borrower finished speaking
    let tFirstToken = 0;            // LLM time-to-first-token (TTFT)
    let tFirstAudio = 0;            // time until first agent audio is queued
    const markAudio = () => { if (!tFirstAudio) tFirstAudio = Date.now() - t0; };

    const buffer = { text: "" };
    let full = "";
    const ttsQueue: Promise<void> = Promise.resolve();
    let chain = ttsQueue;

    try {
      for await (const chunk of this.deps.llmStream(this.system, this.history, text, signal)) {
        if (signal.aborted) break;
        if (!tFirstToken) tFirstToken = Date.now() - t0;   // TTFT
        full += chunk;
        for (const sentence of sentences(buffer, chunk)) {
          if (signal.aborted) break;
          // Synthesize + play each sentence AS SOON as it's complete, in order.
          chain = chain.then(async () => {
            if (signal.aborted) return;
            const audio = await this.deps.ttsSynthesize(sentence, this.lang, signal);
            if (!signal.aborted) { this.deps.sendAudio(audio); markAudio(); }
          }).catch(() => {});
        }
      }
      // Flush any trailing partial sentence.
      const tail = buffer.text.trim();
      if (tail && !signal.aborted) {
        chain = chain.then(async () => {
          const audio = await this.deps.ttsSynthesize(tail, this.lang, signal);
          if (!signal.aborted) this.deps.sendAudio(audio);
        }).catch(() => {});
      }
      await chain;
    } finally {
      if (full) this.history.push({ role: "assistant", content: full });
      this.speaking = false;
      // Per-turn latency line (compare across LLM_PROVIDER=sarvam|zai|emergent).
      const total = Date.now() - t0;
      console.log(
        `[latency] provider=${process.env.LLM_PROVIDER || "sarvam"} lang=${this.lang} ` +
        `ttft=${tFirstToken}ms firstAudio=${tFirstAudio}ms total=${total}ms`,
      );
    }
  }
}

/* ---------------------------------------------------------------------------
INTEGRATION (Twilio Media Streams server, sketch):

  const cm = new ConversationManager(deps, ASHA_SYSTEM_PROMPT, borrower.language);

  // From your VAD:
  vad.on("speech-start", () => cm.onUserSpeechStart());          // barge-in
  // From your streaming ASR (final):
  asr.on("final", (t) => cm.onUserFinalTranscript(t.text, {      // reply
      sentiment: sentimentOf(t) }));
  // On detected language change (debounced): cm.setLanguage(newLang)

  // deps.sendAudio → convert PCM→8kHz μ-law, send Twilio "media" frames
  // deps.clearPlayback → send Twilio { event: "clear", streamSid }
  // deps.getFillerAudio → return the pre-generated cached μ-law for that phrase

STARTUP: pre-generate every filler in fillers.json via Bulbul TTS once and cache the audio,
so onUserFinalTranscript can play one with ZERO synthesis latency.
--------------------------------------------------------------------------- */
