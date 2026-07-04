# EMERGENT INSTRUCTIONS — Add Low-Latency Turn-by-Turn Voice (Non-Destructive)

Paste the block below into Emergent. It ADDS a real-time, Samvaad-style voice path WITHOUT
changing your existing, running app. Everything is new files + a feature flag; your current
`<Record>` flow keeps working exactly as-is and is the fallback.

> Give Emergent these files from this folder as context: `media-stream-server.ts`,
> `sarvam-streaming.ts`, `conversation-manager.ts`, `audio.ts`, `filler-pregen.ts`, `fillers.json`,
> `inbound-route.ts`, plus your Asha prompt (`samvaad-agent-config-skvcb.md`).

---

## PASTE THIS INTO EMERGENT

```
GOAL
Add a REAL-TIME, turn-by-turn, low-latency voice path to my EXISTING loan-recovery app so it talks
like Sarvam's Samvaad finance agent (continuous, empathetic, interruptible, ~1-2s per turn).

HARD CONSTRAINT — DO NOT DISTURB THE EXISTING APP
- Work on a NEW branch "lowlatency-voice". Commit current state first. Do NOT edit or delete the
  existing <Record>-based voice routes, DB schema, business rules, or UI.
- Everything you add is NEW files + ONE new API route + ONE feature flag. The existing flow stays
  the default and the fallback.
- Add a feature flag USE_MEDIA_STREAMS (env, default "false"). Only when "true" (or for a specific
  test number) do calls use the new streaming path. Everything else is unchanged.

WHAT TO ADD (use the provided files as the implementation)
1. NEW standalone media server: media-stream-server.ts (Node/Bun, its own process + port + Docker).
   It is the real-time bridge: Twilio 8kHz μ-law <-> Sarvam streaming ASR/LLM/TTS. It must run as a
   PERSISTENT service (serverless cannot hold a WebSocket), deployed on an always-on host. Do NOT
   put it inside the Next.js serverless app.
2. NEW helper modules (drop in as-is, wire keys): sarvam-streaming.ts (streaming LLM + TTS + STT),
   conversation-manager.ts (filler + sentence-streaming + barge-in), audio.ts (μ-law/resample),
   filler-pregen.ts (pre-generate + cache filler audio at startup), fillers.json.
3. ONE NEW TwiML route (additive): inbound-route.ts → returns <Connect><Stream url=wss://MEDIA_HOST>
   ONLY when USE_MEDIA_STREAMS is true for that call; otherwise return the EXISTING <Record> TwiML
   unchanged. Do not remove the old route.
4. Use my Asha system prompt (I will paste it) for the LLM. Inject the borrower's loan facts as
   variables per call. Keep it loan-only; figures from my DB, never invented.

LOW-LATENCY REQUIREMENTS (already implemented in the files — keep them)
- Instant cached filler on end-of-turn while the LLM thinks (fillers.json).
- Streaming LLM -> sentence-by-sentence TTS (speak sentence 1 while writing sentence 2).
- Barge-in: user speaks -> stop playback (Twilio "clear") + abort in-flight LLM/TTS.
- VAD fast endpointing (~300-500ms). Persistent ASR/LLM/TTS connections. Pre-generated greeting.

MODELS: Sarvam Saaras (ASR, language="unknown" for auto language switch), sarvam-30b (LLM, stream),
Bulbul v3 (TTS, voice "anushka", pace 0.9, NO pitch/loudness on v3).

GOTCHAS (do not repeat): never <Say> (only streamed Sarvam audio); escape & -> &amp; in TwiML;
never <Gather> for Indic ASR; convert 8kHz μ-law <-> 16kHz PCM correctly.

ACCEPTANCE CRITERIA (test on the flagged path only; existing path must still work)
- Flag OFF: app behaves EXACTLY as before (regression check).
- Flag ON: per-turn ~1-2s, barge-in works, mid-call Hindi<->Marathi<->English switching works,
  natural empathetic delivery, stays on loan topics, figures match DB.
- Provide a rollback note (flip flag to false / delete the branch).

DELIVERABLES: the new files wired up, a Dockerfile + run command for the media server, a short
DEPLOY.md (how to host the media server and set MEDIA_HOST + USE_MEDIA_STREAMS), and the new route.
Then place a test call on the flagged number, measure per-turn latency, iterate to ~1-2s.
```

---

## After pasting, give Emergent:
1. The **Asha system prompt + variables** (`samvaad-agent-config-skvcb.md`).
2. Your **DB field names** (to map loan facts into the prompt).
3. The **host** where the media server will run (its public `wss://` URL for MEDIA_HOST).

## Safety checklist (state this to Emergent too)
- [ ] New branch, current state committed first.
- [ ] No edits to existing voice routes / schema / UI.
- [ ] Feature flag defaults OFF.
- [ ] Media server is a separate persistent service, not in serverless.
- [ ] Regression check: with flag OFF, nothing changes.
