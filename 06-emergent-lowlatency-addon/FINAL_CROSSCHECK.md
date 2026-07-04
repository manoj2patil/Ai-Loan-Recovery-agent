# FINAL CROSS-CHECK — Emergent + Claude Code + z.ai + Twilio Build

Audit of the package against your exact build path, the gaps found, and what was fixed.

## Gaps found in audit → FIXED in this version
| Gap | Status |
|---|---|
| **Greeting on pickup was only a comment** — borrower heard silence after answering | ✅ FIXED: media server now speaks a personalized, language-correct greeting the instant Twilio's `start` event arrives (`greeting_played` log). TwiML passes `name`/`bank`/`lang` so it's personal. Filler+greeting caches warm at boot for ~0ms playback. |
| No `package.json` for the media server | ✅ Added (bun or node/tsx). |
| Dockerfile didn't install deps or health-check | ✅ Rewritten with `bun install` + Docker HEALTHCHECK on `/health`. |
| No health endpoint | ✅ `/health` returns 200 + activeCalls when ready — point Twilio only after it's green. |
| No per-call structured logging / error isolation | ✅ JSON logs keyed by callSid; one bad call can't kill the process; WS errors caught. |
| Turn errors caused dead air | ✅ Fail-soft: brief "माफ़ कीजिए… क्या आप दोहरा सकते हैं?" then keeps listening. |
| No graceful shutdown | ✅ SIGINT/SIGTERM drain with 10s timeout. |

## The call experience now (turn-by-turn, verified design)
```
Twilio dials → borrower picks up → Twilio opens /media WS → "start" event
  → ★ GREETING PLAYS IMMEDIATELY (cached TTS, personalized, correct language)
borrower replies (anything) → VAD endpoints in ~400ms
  → instant filler ("अच्छा…") while LLM thinks
  → streaming LLM → first sentence → TTS → audio (sentence 2 still being written)
borrower interrupts → Twilio "clear" + abort in-flight LLM/TTS (barge-in)
language changes → Saaras auto-detects → TTS switches (same voice gender)
turn latency logged: [latency] provider=… ttft=…ms firstAudio=…ms total=…ms
```

## Division of labour (your three tools)
- **Emergent** — hosts/extends the existing Next.js app: the new feature-flagged TwiML route
  (`inbound-route.ts`), the dialer, UI. Give it `EMERGENT_INSTRUCTIONS.md`.
- **Claude Code** — builds/refines the standalone media server + libraries (this folder) and the
  DB wiring. Give it folder `04-claude-code-build` (CLAUDE.md pins the rules) + this folder.
- **z.ai** — LLM **fallback** (`glm-4.7-flash`) via `llm-providers.ts`. Primary for live calls =
  **Sarvam-direct** (Indic quality + no extra hop). A/B with the built-in latency logger.

## Production checklist (do before real borrowers)
- [ ] Wire `lookupBorrower()` (media server + inbound route) to PostgreSQL; remove stub prompt env.
- [ ] Paste the full Asha prompt via `buildAshaPrompt(borrower)` (03-prompts-and-config/) — static
      rules + dynamic ledger block. Never ship the stub.
- [ ] Compliance Gate in the dialer BEFORE every call (hours 9–19, consent, caps, suppression).
- [ ] Recording ON for every call + persist VoiceCall/InteractionLog on close (hook marked).
- [ ] Replace energy VAD with Silero VAD for crisper endpointing (marked in audio.ts).
- [ ] Verify current Sarvam TTS/ASR request shapes + z.ai/Emergent streaming (SSE) — marked spots.
- [ ] Native-speaker + compliance review of Hindi/Marathi greeting wording (it is verbatim legal text).
- [ ] Deploy media server on an always-on host (systemd/Docker) behind TLS; check /health; then
      point the Twilio test number at the flagged route. Flag OFF = old behaviour (regression-safe).

## Still intentionally out of scope here (covered elsewhere in the package)
Campaign auto-dialer UI, WhatsApp notices, business-rules engine, dashboards → folders 01/04/05.
