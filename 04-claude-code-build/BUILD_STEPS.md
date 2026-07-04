# BUILD_STEPS.md — Step-by-step prompts for Claude Code

How to use: open Claude Code in an empty repo with these files present
(`CLAUDE.md`, `SCHEMA.md`, `database-backup.json`, `reference-code/`). Run the steps in order.
Each step is a prompt you can paste. Verify the "Check" before moving on. Claude Code should
read `CLAUDE.md` first (it does automatically) and follow the GOLDEN RULES + VOICE LESSONS.

---

### Step 0 — Scaffold
> "Read CLAUDE.md and SCHEMA.md. Scaffold a Next.js 16 (App Router, TypeScript) project with
> Prisma + PostgreSQL, Tailwind, and a Bun script entry. Add a docker-compose for local
> Postgres 16 + pgvector. Set up .env from the variables referenced in CLAUDE.md."

**Check:** `npm run dev` serves a blank app; `docker compose up` starts Postgres with pgvector.

### Step 1 — Database from the real schema
> "Generate prisma/schema.prisma from SCHEMA.md using the EXACT camelCase field names and the
> relationships listed (Loan.customerId → Customer.id, Guarantor.linkedLoanId → Loan.id, etc.).
> Model the stringified-JSON columns as String. Then write prisma/seed.ts that loads
> database-backup.json into the DB. Run migrate + seed."

**Check:** all 12 tables created; row counts match (64 Customer, 131 Loan, 16344 Installment…).

### Step 2 — Config + data access
> "Add lib/config.ts to read SystemConfig from the DB (BANK_NAME, CALLING_HOURS_*, MAX_*,
> *_THRESHOLD). Add a read API over customers/loans with joins, parsing the JSON columns
> (consent, suppression, complianceGate). Never hardcode the bank name or thresholds."

**Check:** an endpoint returns a borrower with joined loan + parsed consent/suppression.

### Step 3 — Compliance Gate (build + test FIRST, everything depends on it)
> "Implement lib/compliance-gate.ts following GOLDEN RULE 2. evaluate({customerId, channel,
> intent}) → {decision:'allow'|'defer'|'veto', reason}. Checks in order: calling hours (9–19),
> suppression flags, per-channel consent, frequency caps (MAX_CALLS_PER_DAY/MAX_WHATSAPP_PER_DAY
> from config, counting today's InteractionLog), notice clock, channel eligibility (WhatsApp =
> Utility only), contact whitelist (borrower or registered guarantor only). Persist the decision.
> Add a testMode flag to bypass hours+caps for testing only. Write unit tests for every veto reason."

**Check:** tests pass for each veto/defer/allow path.

### Step 4 — Sarvam clients
> "Use reference-code/sarvam.ts as the basis for lib/sarvam.ts. Implement asrTranscribe(),
> llmReply(), ttsSynthesize() supporting BOTH cloud Sarvam APIs and self-hosted endpoints via
> env base URLs. Apply the VOICE LESSONS: Bulbul speaker 'anushka', pace 0.8, correct sample
> rates, and a TTS cache keyed by hash(text+lang+voice)."

**Check:** a unit test synthesizes Hindi TTS to a wav and transcribes a sample clip via Saarika.

### Step 5 — Helpers: amountToSpeech + language
> "Implement lib/amount-to-speech.ts (numbers → native words for hi/mr/en, extend later) and
> lib/language.ts (detectExplicitLanguageRequest + anti-Hindi-bias for Devanagari). Use
> reference-code/amount-to-speech.ts and language.ts as starting points."

**Check:** 228000 → 'दोन लाख अठ्ठावीस हजार रुपये' (mr); 'speak in English' → en-IN.

### Step 6 — Voice MVP (Twilio <Record> path) to prove the pipeline
> "Create the <Record>-based TwiML routes: /api/voice/twiml/start (Play greeting + Record) and
> /api/voice/twiml/transcribe (download recording → Sarvam ASR → LLM → TTS → return Play+Record).
> Use ONLY <Play> (never <Say>). Escape all URLs (escapeXml). Place outbound calls via
> /api/voice/twilio/dial AFTER a compliance-gate ALLOW. Pre-generate the greeting TTS in /dial."

**Check:** a real call to a seeded borrower plays Sarvam greeting and holds a multi-turn convo.

### Step 7 — Voice PROD (Twilio Media Streams) — the latency fix
> "Use reference-code/media-stream-server.ts to build scripts/media-stream-server.ts (Bun, port
> 3001): accept Twilio Media Stream WS, decode 8 kHz μ-law → 16 kHz PCM, stream to Sarvam ASR,
> on transcript call LLM (streaming), stream TTS back as μ-law frames, implement barge-in. Add
> /api/voice/inbound returning <Connect><Stream url=wss://.../>. Wire Nginx TLS proxy for 3001."

**Check:** a Media Streams call responds in ~1–2s, supports interruption, switches language.

### Step 8 — Business Rules engine
> "Implement lib/business-rules.ts: 12 default RBI rules across DPD buckets 0-30/31-60/61-90/
> 91-180/180+, 6 action types (WhatsApp, Voice, Guarantor Escalation, SARFAESI, Human Handoff,
> Email), each with trigger day, max/day, calling hours, template, language, RBI reference.
> CRUD API at /api/business-rules (create/update/delete/toggle; protect default rules)."

**Check:** rules list + RBI compliance summary render; toggling persists.

### Step 9 — WhatsApp notices
> "Implement /api/whatsapp/send-notice: auto-pick notice type by DPD bucket, render in the
> borrower's language, run the compliance gate, send via WhatsApp Business API (Utility), log to
> WhatsappMessage + InteractionLog. Seed templates from WhatsappTemplate rows."

**Check:** a gated reminder sends (sandbox) and logs.

### Step 10 — Campaign auto-dial
> "Implement /api/voice/campaign/start (segment by DPD/product/language, gate-check all, build
> queue) and /next (dial next, pre-generate greeting). Add the campaign UI (filters + live stats)."

**Check:** a campaign queues only compliant borrowers and auto-dials sequentially.

### Step 11 — CBS + CSV
> "Implement lib/cbs-integration.ts (CBSLoan 24 fields; vendor Finacle/Flexcube/BaNCS/FinnOne)
> with /api/cbs/fetch + sync, and CSV import/export (/api/data/template|import|export, 24 cols)."

**Check:** CSV round-trips; CBS fetch upserts customers+loans+guarantors.

### Step 12 — Guarantor escalation, recording, dashboards
> "Add guarantor escalation at GUARANTOR_DPD_THRESHOLD (contact guarantor only, with consent);
> start call recording (store recordingUrl); build the officer/compliance/admin dashboards over
> the data and live calls; wire Langfuse + Prometheus."

**Check:** escalation respects whitelist; recordings saved; dashboards show KPIs.

### Step 13 — On-prem swap
> "Switch the Sarvam clients to the self-hosted endpoints (SARVAM_LLM_BASE_URL :8000,
> SARVAM_TTS_BASE_URL :8001, SARVAM_ASR_WS_URL :8002) via env, with no orchestration changes.
> Add systemd units + Nginx config per the deployment guide."

**Check:** the same app runs against self-hosted models (air-gapped).

---

## Tips for driving Claude Code
- Work **one step per session**; commit after each. Keep CLAUDE.md open so rules persist.
- After each step say: "Run typecheck + tests and fix until green."
- If a voice bug appears, point Claude Code at the relevant VOICE LESSON in CLAUDE.md.
- Pin dependency versions after the first green build.
