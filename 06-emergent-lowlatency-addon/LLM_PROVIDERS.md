# LLM Providers — z.ai + Emergent (and Sarvam-direct)

Your app can reach the LLM three ways. `llm-providers.ts` supports all three with streaming +
fallback. **ASR and TTS always go straight to Sarvam — never through z.ai/Emergent** (that would
add latency on audio for no benefit).

## Key facts (so you pick correctly)
- **z.ai = Zhipu GLM models, NOT Sarvam.** It's an OpenAI-compatible gateway to GLM
  (`glm-4.7-flash` = fast/cheap, `glm-5.2` = flagship). Your "Sarvam-30B via z.ai" is really a GLM
  model. GLM is capable but **not Indic-specialised** the way Sarvam-30B is.
- **Emergent** gives you a universal LLM key/proxy — convenient, but it's another network hop.
- **Sarvam-direct** is best for Indian languages **and** lowest latency (no extra hop).

## Recommendation for a low-latency Indic voice agent
1. **Primary (live calls): Sarvam-direct** → `LLM_PROVIDER=sarvam`, model `sarvam-30b`.
2. **Fallback: z.ai** (`glm-4.7-flash` is fast) → `LLM_FALLBACK=zai`.
3. Use **Emergent's key** for dev/testing convenience, but avoid it as the live-call primary if it
   adds latency or doesn't stream.
> Whatever you choose, the provider MUST support **streaming (SSE)** — the sentence-by-sentence TTS
> trick (and thus the low latency) depends on it. If z.ai/Emergent buffer the full reply, you lose it.

## .env — fill the block(s) you use
```
# Which provider drives live calls, and the fallback if it errors
LLM_PROVIDER=sarvam        # sarvam | zai | emergent
LLM_FALLBACK=zai

# --- z.ai (GLM) ---
ZAI_BASE_URL=https://api.z.ai/api/paas/v4     # coding plan: https://api.z.ai/api/coding/paas/v4
ZAI_API_KEY=your_zai_key
ZAI_MODEL=glm-4.7-flash                        # fast; or glm-5.2 for quality

# --- Emergent (universal LLM proxy) ---
EMERGENT_BASE_URL=<from Emergent integration docs>   # OpenAI-compatible /chat/completions base
EMERGENT_LLM_KEY=your_emergent_llm_key
EMERGENT_MODEL=sarvam-30b                             # or whatever Emergent exposes

# --- Sarvam-direct (recommended primary for Indic + lowest latency) ---
SARVAM_BASE_URL_LLM=https://api.sarvam.ai/v1
SARVAM_API_KEY=your_sarvam_key
SARVAM_LLM_MODEL=sarvam-30b
```

## Wiring
- In `media-stream-server.ts` / `conversation-manager.ts`, import `llmStream` from
  `llm-providers.ts` (instead of the single-provider one in `sarvam-streaming.ts`). Everything else
  (filler, streaming TTS, barge-in) is unchanged.
- Keep `ttsSynthesize` and `sttTranscribe` importing from `sarvam-streaming.ts` (Sarvam direct).

## A/B the latency (do this)
Place identical test calls with `LLM_PROVIDER=sarvam` vs `zai` vs `emergent` and compare per-turn
time. Pick the one that streams and is fastest for your region. In most Indic setups, Sarvam-direct
wins on both quality and latency; z.ai `glm-4.7-flash` is a strong, fast fallback.

## Verify (these can change)
- z.ai base URL + model names (`glm-4.7-flash`, `glm-5.2`) from the Z.AI console.
- Emergent's exact proxy base URL + supported model strings from Emergent's integration docs.
- That each provider returns SSE deltas in the standard `choices[].delta.content` shape (the parser
  in `llm-providers.ts` expects OpenAI-style streaming).
```
