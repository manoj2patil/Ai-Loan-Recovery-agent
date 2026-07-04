// sarvam-streaming.ts — Sarvam streaming clients (LLM stream, TTS, STT).
// Verify exact model strings/params against current Sarvam docs; wire SARVAM_API_KEY.

const KEY = process.env.SARVAM_API_KEY!;
const BASE = process.env.SARVAM_BASE_URL || "https://api.sarvam.ai";

// ---------------------------------------------------------------- LLM (stream)
// OpenAI-compatible chat completions with stream=true (SSE). Yields text deltas.
export async function* llmStream(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  user: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: process.env.SARVAM_LLM_MODEL || "sarvam-30b",
      temperature: 0.3,
      max_tokens: 220,               // short replies = lower latency + more natural
      stream: true,
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch { /* keep going */ }
    }
  }
}

// ---------------------------------------------------------------- TTS (cached)
// Returns 16-bit PCM at `sampleRate`. Cache by text+lang+voice+rate.
const ttsCache = new Map<string, ArrayBuffer>();

export async function ttsSynthesize(
  text: string,
  lang: string,
  signal: AbortSignal,
  sampleRate = 8000,               // 8k for Twilio μ-law path
  voice = process.env.SARVAM_TTS_VOICE || "anushka",
): Promise<ArrayBuffer> {
  const key = `${text}|${lang}|${voice}|${sampleRate}`;
  const hit = ttsCache.get(key);
  if (hit) return hit;

  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "api-subscription-key": KEY },
    body: JSON.stringify({
      text,                                   // (older API used "inputs":[text])
      target_language_code: lang,
      speaker: voice,
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
      pace: 0.9,                              // NO pitch/loudness on bulbul:v3 (400 error)
      speech_sample_rate: sampleRate,
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const json = await res.json();
  // Response: { audios: [base64Wav] } — decode base64 → PCM (strip WAV header if present).
  const b64 = json.audios?.[0] ?? json.audio;
  const bytes = Buffer.from(b64, "base64");
  const pcm = stripWavHeader(bytes);          // returns raw PCM ArrayBuffer
  ttsCache.set(key, pcm);
  return pcm;
}

// ---------------------------------------------------------------- STT (batch on end-of-turn)
// Simple + reliable: buffer the user's utterance (VAD-gated) then transcribe once. The filler
// covers the gap. (Upgrade to streaming STT later if Sarvam exposes a WS endpoint.)
export async function sttTranscribe(
  wavBytes: Buffer,                            // 16kHz PCM wrapped as WAV
  signal: AbortSignal,
): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  form.append("model", process.env.SARVAM_ASR_MODEL || "saaras:v2");
  form.append("language_code", "unknown");    // auto-detect → enables mid-call language switch
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST", signal, headers: { "api-subscription-key": KEY }, body: form as any,
  });
  if (!res.ok) throw new Error(`STT ${res.status}`);
  const json = await res.json();
  return { text: json.transcript || "", language: json.language_code || "hi-IN" };
}

// --- helpers ---
function stripWavHeader(buf: Buffer): ArrayBuffer {
  // If it's a RIFF/WAVE, skip the 44-byte header to raw PCM; else return as-is.
  if (buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF") {
    return buf.subarray(44).buffer.slice(buf.byteOffset + 44, buf.byteOffset + buf.length);
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
