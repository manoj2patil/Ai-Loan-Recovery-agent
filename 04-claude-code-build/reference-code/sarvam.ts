// lib/sarvam.ts — Sarvam ASR / LLM / TTS clients (cloud + self-hosted)
// Reference skeleton for Claude Code. Fill in TODOs and add error handling/tests.
//
// VOICE LESSONS baked in (do not change without reason):
//  - TTS speaker 'anushka' (meera deprecated), pace 0.8 for phone clarity
//  - sample rate 22050 for REST <Play>, 8000 for Media Streams μ-law
//  - Sarvam ASR (Saarika) handles all 11 Indic incl. Marathi (Twilio Gather cannot)
//  - Env-driven base URLs so we swap cloud <-> self-hosted with no code change

type Lang =
  | "hi-IN" | "mr-IN" | "ta-IN" | "te-IN" | "kn-IN"
  | "ml-IN" | "gu-IN" | "pa-IN" | "bn-IN" | "en-IN" | "od-IN";

const CLOUD = {
  base: "https://api.sarvam.ai",
  key: process.env.SARVAM_API_KEY ?? "",
};

// Self-hosted endpoints (on-prem GPU server). When set, these take precedence.
const SELF = {
  llmBase: process.env.SARVAM_LLM_BASE_URL,       // http://10.0.2.10:8000/v1 (OpenAI-compatible)
  llmModel: process.env.SARVAM_LLM_MODEL ?? "sarvam-30b",
  ttsBase: process.env.SARVAM_TTS_BASE_URL,       // http://10.0.2.10:8001
  asrWs: process.env.SARVAM_ASR_WS_URL,           // ws://10.0.2.10:8002/ws/asr
};

// ---------------------------------------------------------------- ASR
/** Transcribe an audio buffer (wav/PCM). Cloud = Saarika REST; self-hosted = REST/WS. */
export async function asrTranscribe(audio: Buffer, languageHint: Lang | "unknown" = "unknown") {
  if (SELF.asrBaseRest()) {
    // TODO self-hosted REST transcribe
  }
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
  form.append("model", "saarika:v2");
  form.append("language_code", languageHint);
  const res = await fetch(`${CLOUD.base}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": CLOUD.key },
    body: form,
  });
  if (!res.ok) throw new Error(`ASR ${res.status}`);
  const json = await res.json();
  // returns { transcript, language_code }
  return { text: json.transcript as string, language: json.language_code as Lang };
}

// For Media Streams: open a streaming ASR socket to the self-hosted ASR (16 kHz PCM in,
// partial/final transcripts out). See media-stream-server.ts for usage.
export function asrStreamUrl() {
  return SELF.asrWs; // ws://...:8002/ws/asr  (raw 16 kHz mono PCM frames)
}

// ---------------------------------------------------------------- LLM
/** Generate the agent reply. OpenAI-compatible for both cloud and self-hosted vLLM. */
export async function llmReply(opts: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  stream?: boolean;
}) {
  const base = SELF.llmBase ?? `${CLOUD.base}/v1`;
  const model = SELF.llmBase ? SELF.llmModel : "sarvam-m"; // pick hot-path model
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SELF.llmBase ? process.env.SARVAM_LLM_API_KEY : CLOUD.key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: opts.stream ?? false, // STREAM for low latency (start TTS on first clause)
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  // TODO: if stream, parse SSE token-by-token and yield clauses to TTS.
  const json = await res.json();
  return json.choices[0].message.content as string;
}

// ---------------------------------------------------------------- TTS
const ttsCache = new Map<string, Buffer>(); // key = hash(text|lang|voice|rate)

/** Synthesize speech. Returns audio buffer. Cache aggressively (greeting served in ms). */
export async function ttsSynthesize(opts: {
  text: string;
  language: Lang;
  voice?: string;      // default 'anushka' (meera deprecated)
  sampleRate?: number; // 22050 for <Play>; 8000 for Media Streams μ-law
}) {
  const voice = opts.voice ?? "anushka";
  const rate = opts.sampleRate ?? 22050;
  const key = `${opts.text}|${opts.language}|${voice}|${rate}`;
  const hit = ttsCache.get(key);
  if (hit) return hit;

  const base = SELF.ttsBase ?? CLOUD.base;
  const url = SELF.ttsBase ? `${base}/synthesize` : `${base}/text-to-speech`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SELF.ttsBase ? {} : { "api-subscription-key": CLOUD.key }),
    },
    body: JSON.stringify({
      text: opts.text,
      target_language_code: opts.language,
      speaker: voice,
      pace: 0.8,                 // LESSON: slower for phone clarity
      speech_sample_rate: rate,
      model: "bulbul:v2",
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  ttsCache.set(key, buf);
  return buf;
}

// Helper used by the self-hosted branch detection
(SELF as any).asrBaseRest = () => false; // TODO if self-hosted ASR also exposes REST
