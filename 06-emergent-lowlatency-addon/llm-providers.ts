// llm-providers.ts — pluggable LLM for the voice hot path.
// Supports z.ai (GLM), Emergent (proxy), and Sarvam-direct. Streaming SSE + fallback.
// IMPORTANT: this is ONLY for the LLM. ASR + TTS always go straight to Sarvam (see
// sarvam-streaming.ts) — never route audio through z.ai/Emergent (pure added latency).

type Msg = { role: "system" | "user" | "assistant"; content: string };

interface Provider {
  baseUrl: string;   // OpenAI-compatible; must expose /chat/completions
  apiKey: string;
  model: string;
  authHeader?: (k: string) => Record<string, string>;
}

// --- Provider registry (fill keys/models via env) ------------------------------------
const PROVIDERS: Record<string, Provider> = {
  // z.ai = Zhipu GLM. OpenAI-compatible. NOTE: these are GLM models, not Sarvam.
  //   general endpoint: https://api.z.ai/api/paas/v4   |  coding plan: .../api/coding/paas/v4
  //   fast/cheap: glm-4.7-flash   flagship: glm-5.2
  zai: {
    baseUrl: process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4",
    apiKey: process.env.ZAI_API_KEY || "",
    model: process.env.ZAI_MODEL || "glm-4.7-flash",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
  },

  // Emergent universal LLM proxy (uses your Emergent LLM key). Confirm the exact base URL +
  // model string in Emergent's integration docs; it is OpenAI-compatible.
  emergent: {
    baseUrl: process.env.EMERGENT_BASE_URL || "https://llm.emergentagent.com/v1",
    apiKey: process.env.EMERGENT_LLM_KEY || "",
    model: process.env.EMERGENT_MODEL || "sarvam-30b",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
  },

  // Sarvam-direct — BEST for Indic + LOWEST latency (no extra hop). Recommended primary for calls.
  sarvam: {
    baseUrl: process.env.SARVAM_BASE_URL_LLM || "https://api.sarvam.ai/v1",
    apiKey: process.env.SARVAM_API_KEY || "",
    model: process.env.SARVAM_LLM_MODEL || "sarvam-30b",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
  },
};

const PRIMARY = process.env.LLM_PROVIDER || "sarvam";     // sarvam | zai | emergent
const FALLBACK = process.env.LLM_FALLBACK || "zai";       // used if primary errors

async function* streamFrom(p: Provider, messages: Msg[], signal: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...(p.authHeader?.(p.apiKey) || {}) },
    body: JSON.stringify({
      model: p.model,
      temperature: 0.3,
      max_tokens: 220,        // short replies = lower latency + more natural
      stream: true,           // MUST stream for the sentence-by-sentence TTS trick
      messages,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${p.model} ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const d = l.slice(5).trim();
      if (d === "[DONE]") return;
      try {
        const j = JSON.parse(d);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch { /* skip keep-alives */ }
    }
  }
}

/** Drop-in for ConversationManager: streams from primary, falls back on error. */
export async function* llmStream(
  system: string,
  history: Msg[],
  user: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const messages: Msg[] = [{ role: "system", content: system }, ...history, { role: "user", content: user }];
  try {
    yield* streamFrom(PROVIDERS[PRIMARY], messages, signal);
  } catch (e) {
    if (signal.aborted) return;
    console.warn(`LLM primary '${PRIMARY}' failed (${e}); falling back to '${FALLBACK}'`);
    yield* streamFrom(PROVIDERS[FALLBACK], messages, signal);
  }
}
