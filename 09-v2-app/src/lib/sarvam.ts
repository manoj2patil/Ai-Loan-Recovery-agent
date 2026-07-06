// src/lib/sarvam.ts — Sarvam clients for the live conversation loop.
//   LLM: sarvam-30b (OpenAI-compatible chat completions; it's a reasoning model, so we
//        budget tokens and strip the <reasoning> so only the spoken reply is returned).
//   TTS: bulbul (anushka — the female "Asha" voice), returned as an 8 kHz WAV buffer for
//        Twilio <Play>.
// On-prem swap: point SARVAM_LLM_BASE_URL / SARVAM_TTS_BASE_URL at the self-hosted
// endpoints (vLLM :8000 / TTS :8001) — same call shape, no orchestration change.

const KEY = () => process.env.SARVAM_API_KEY || "";
const LLM_URL = () => (process.env.SARVAM_LLM_BASE_URL || "https://api.sarvam.ai") + "/v1/chat/completions";
const TTS_URL = () => (process.env.SARVAM_TTS_BASE_URL || "https://api.sarvam.ai") + "/text-to-speech";

export const LANG_CODE: Record<string, string> = {
  mr: "mr-IN", hi: "hi-IN", en: "en-IN", bn: "bn-IN", gu: "gu-IN", kn: "kn-IN",
  ml: "ml-IN", pa: "pa-IN", ta: "ta-IN", te: "te-IN",
};

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

// Model tiers: 30b is the fast hot path (greetings, simple turns); 105b is the deeper
// negotiator (hardship, disputes, multi-loan, settlement reasoning) — ROADMAP Phase 4.
export type Tier = "fast" | "deep";
function modelFor(tier: Tier): string {
  if (tier === "deep") return process.env.SARVAM_LLM_MODEL_DEEP || "sarvam-105b";
  return process.env.SARVAM_LLM_MODEL || "sarvam-30b";
}

/** One LLM turn. Returns the assistant's spoken reply. sarvam-30b/105b are REASONING models:
 *  they emit a long `reasoning_content` and the final answer in `content`, so we must budget
 *  enough tokens for both — too few and `content` comes back empty. We use `content` only. */
export async function chat(messages: ChatMessage[], opts?: { maxTokens?: number; tier?: Tier }): Promise<string> {
  const payload: Record<string, unknown> = {
    model: modelFor(opts?.tier ?? "fast"),
    messages,
    max_tokens: opts?.maxTokens ?? 2000,   // reasoning + answer both need to fit
    temperature: 0.3,
  };
  // Lower reasoning effort trims latency on the phone path (ignored if unsupported).
  if (process.env.SARVAM_REASONING_EFFORT) payload.reasoning_effort = process.env.SARVAM_REASONING_EFFORT;

  const res = await fetch(LLM_URL(), {
    method: "POST",
    headers: { "api-subscription-key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(`Sarvam LLM ${res.status}: ${body?.error?.message ?? "chat failed"}`);
  const text: string = body?.choices?.[0]?.message?.content ?? "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Dedicated PTP extractor — decoupled from reply generation for reliability. Given the
 *  borrower's utterance and today's date, returns whether they committed to a pay date. */
export async function extractPtp(utterance: string, todayIso: string): Promise<{ committed: boolean; date: string | null }> {
  try {
    const raw = await chat([
      { role: "system", content:
        `Today is ${todayIso}. The user is a loan borrower. From their message, extract the date they PROMISE to pay. ` +
        `Output STRICT JSON only: {"committed": true|false, "date": "YYYY-MM-DD"|null}. ` +
        `If they name a day-of-month (e.g. 6th / सहा तारीख), use the NEXT occurrence from today. ` +
        `committed is true only for a clear promise with a date. No other text.` },
      { role: "user", content: utterance },
    ], { maxTokens: 3000 });
    const json = raw.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(json);
    return { committed: !!parsed.committed, date: parsed.date ?? null };
  } catch {
    return { committed: false, date: null };
  }
}

/** Synthesize speech → WAV buffer (8 kHz for Twilio telephony). */
export async function tts(text: string, lang: string): Promise<Buffer> {
  const res = await fetch(TTS_URL(), {
    method: "POST",
    headers: { "api-subscription-key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: LANG_CODE[lang] || "hi-IN",
      speaker: process.env.SARVAM_TTS_SPEAKER || "anushka",  // female — "Asha"
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v2",
      pace: 0.9,
      speech_sample_rate: 8000,   // Twilio plays 8 kHz μ-law/PCM WAV cleanly
    }),
  });
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok || !body?.audios?.[0]) throw new Error(`Sarvam TTS ${res.status}: ${body?.error?.message ?? "tts failed"}`);
  return Buffer.from(body.audios[0], "base64");
}

export function sarvamConfigured(): boolean {
  return !!KEY();
}
