# CLAUDE.md — Sah-Ayak Loan-Recovery Voice Agent

> Claude Code reads this file automatically. It is the source of truth for HOW to build.
> Read it fully before writing code. Then read `BUILD_STEPS.md`, `SCHEMA.md`, and the
> reference skeletons in `reference-code/`. Following the LESSONS below avoids the exact
> bugs we already hit once — do not re-discover them.

## Project
**Sah-Ayak** — an on-premises AI loan-recovery voice agent for **Sahakar Krishi Vikas
Cooperative Bank Ltd. (SKVCB)**, Pune. It calls overdue borrowers over Twilio, talks in
their language via Sarvam (ASR/LLM/TTS), sends WhatsApp reminders, and is governed by an
RBI-compliant business-rules + compliance gate. Real seed data is in `database-backup.json`.

## Stack (use exactly this — it is proven)
- **App:** Next.js 16 (App Router, API routes) + TypeScript
- **ORM/DB:** Prisma + PostgreSQL 16 + pgvector
- **Telephony:** Twilio (PSTN). Production voice path = **Twilio Media Streams** (`<Connect><Stream>`)
- **Realtime voice bridge:** **Bun WebSocket server** (`scripts/media-stream-server.ts`, port 3001)
- **Speech/LLM (Sarvam):**
  - ASR: Sarvam **Saarika** (cloud) OR self-hosted Sarvam-ASR WS (`:8002`, 16 kHz PCM)
  - LLM: Sarvam (cloud `sarvam-30b`/`sarvam-m`) OR self-hosted via vLLM (`:8000`, OpenAI-compatible)
  - TTS: Sarvam **Bulbul** (cloud) OR self-hosted Sarvam-TTS (`:8001`)
- **WhatsApp:** WhatsApp Business API (Utility templates)
- **Infra:** Nginx (TLS), systemd, Langfuse + Prometheus/Grafana; 3 servers (App/GPU/DB), 2× A100 80GB

## Data (already provided)
- `database-backup.json` — real export, 12 tables (Customer, Loan, Installment, Guarantor,
  InteractionLog, WhatsappTemplate, WhatsappMessage, VoiceCall, AgentNote, SemanticMemory,
  SystemConfig, NpaRun). 64 customers, 131 loans, 16k installments.
- `SCHEMA.md` — exact field names/types/enums/relationships. **Build the Prisma schema from this.**
- `SystemConfig` holds live rules/stack: BANK_NAME, CALLING_HOURS_START=9, CALLING_HOURS_END=19,
  MAX_CALLS_PER_DAY=2, MAX_WHATSAPP_PER_DAY=3, GUARANTOR_DPD_THRESHOLD=60, NPA_DPD_THRESHOLD=90,
  SARFAESI_NOTICE_DAYS=60. **Read these — never hardcode.**

## GOLDEN RULES (violations are the usual source of "errors")
1. **Ledger-only figures.** The LLM never invents an amount/EMI/balance/date. They come from
   Prisma/DB via a tool/function. Inject the borrower's loan facts into context per call.
2. **Compliance gate before every outreach.** Check calling hours (9–19), per-channel consent,
   frequency caps (2 calls/3 WA per day), suppression flags, notice clock, and contact whitelist
   (borrower + registered guarantor only). Log the gate decision (store as JSON, see schema).
3. **Verify identity before disclosure.** No loan detail until the borrower confirms the last 4
   of Aadhaar (`maskedAadhaar`). **There is NO DOB field** in the data.
4. **Record every call; log every interaction** (VoiceCall + InteractionLog with gate decision).
5. **On-prem / air-gap capable.** Keep a clean swap between cloud Sarvam APIs and self-hosted
   endpoints (env-driven base URLs). No hard cloud dependency at runtime.
6. **Streaming-first voice.** Use Media Streams + streaming ASR/LLM/TTS. A 4–5s+ gap means a
   non-streaming pipeline — see LESSONS.

## VOICE LESSONS (hard-won — bake these in, do NOT repeat)
1. **Do NOT use Twilio `<Gather>` ASR for Indic.** It cannot transcribe Marathi and hallucinates
   Hindi. Use `<Record>` (MVP) or **Media Streams** (prod) + **Sarvam ASR** (handles all 11 Indic).
2. **Only `<Play>` (Sarvam TTS). NEVER `<Say>` (Polly).** Both = double voice.
3. **Escape `&` → `&amp;`** in every TwiML action/URL (`escapeXml()`), or calls error out with
   "Application error... goodbye".
4. **TTS config:** Bulbul speaker `anushka` (`meera` is deprecated), **pace 0.8**, sample rate
   **22050** for REST `<Play>`, **8000 μ-law** for Media Streams.
5. **`amountToSpeech`:** convert numbers to native words per language (Marathi/Hindi compound
   numbers) before TTS — digits read awkwardly.
6. **Language:** default to the borrower's `preferredLanguage`; support explicit switches
   (`detectExplicitLanguageRequest`: "मराठीत बोल", "speak in English"); apply an anti-Hindi-bias
   guard for Devanagari languages so Marathi isn't forced to Hindi.
7. **Latency fixes:** pre-generate + cache greeting TTS (serve in ms), async/fire-and-forget DB
   writes, `Promise.all` parallel fetches, merge endpoints to avoid TwiML `<Redirect>` hops.
8. **Media Streams audio:** Twilio sends/receives **8 kHz μ-law**; convert μ-law→16 kHz PCM for
   ASR, and TTS PCM→8 kHz μ-law back to Twilio. Implement barge-in (stop TTS when speech detected).

## Repo layout (target)
```
app/                      # Next.js App Router (UI + API routes)
  api/voice/inbound/      # TwiML <Connect><Stream> (prod) + <Record> fallback
  api/voice/...           # dial, status, place-call, campaign, tts-audio
  api/whatsapp/...        # send-notice, webhook
  api/business-rules/     # CRUD
  api/cbs/, api/data/     # CBS fetch + CSV import/export
lib/
  sarvam.ts               # ASR/LLM/TTS clients (cloud + self-hosted), config + lessons
  compliance-gate.ts      # the veto (hours, consent, caps, suppression, notice, whitelist)
  business-rules.ts       # 12 RBI rules, 5 DPD buckets, 6 action types
  amount-to-speech.ts     # number→words per language
  language.ts             # detectExplicitLanguageRequest + anti-Hindi-bias
  cbs-integration.ts      # CBSLoan (24 fields), fetch/sync
scripts/
  media-stream-server.ts  # Bun WS bridge (port 3001) — the latency-critical piece
prisma/
  schema.prisma           # generated from SCHEMA.md
  seed.ts                 # loads database-backup.json
```

## Definition of done (per feature)
Builds + typechecks; gate enforced; figures from DB; call recorded + logged; language correct;
no `<Say>`; URLs escaped; latency target met (Media Streams ~1–2s).
