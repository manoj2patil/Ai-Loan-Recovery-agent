# Sah-Ayak — AI Loan-Recovery Voice Agent · FINAL PACKAGE

Everything from the project, consolidated. Built for **Sahakar Krishi Vikas Cooperative Bank
(SKVCB)**: an on-premises-capable, RBI-compliant, multilingual voice + WhatsApp loan-recovery agent
on **Saaras (ASR) + Bulbul (TTS) + Sarvam-30B/105B (LLM)**, with Twilio telephony.

---

## Read in this order

| # | Folder | What it is | Audience |
|---|---|---|---|
| 1 | `01-strategy-and-planning/` | The full plan, competitive landscape, features, hardware, BA user-stories, QA transcripts, production stack guide | Leadership, PM, BA |
| 2 | `02-data-and-schema/` | Real CBS export (`database-backup.json`) + exact `SCHEMA.md` | Everyone building |
| 3 | `03-prompts-and-config/` | The hardened **Asha** system prompt + **Samvaad** agent config | Whoever configures the agent |
| 4 | `04-claude-code-build/` | `CLAUDE.md` + step-by-step build prompts + reference code to build via Claude Code | Engineers (build from scratch) |
| 5 | `05-fullstack-app/` | React + Python(FastAPI/LiveKit) + PostgreSQL app scaffold | Engineers |
| 6 | `06-emergent-lowlatency-addon/` | **Non-destructive** low-latency upgrade for your existing Emergent app (Media Streams, filler, barge-in, multi-LLM) | Engineers (improve running app) |
| 7 | `07-python-livekit-pilot/` | Minimal LiveKit + Sarvam pilot wired to the real data | Engineers (quick pilot) |

---

## The 6 non-negotiable rules (apply everywhere)
1. **Ledger-only figures** — the LLM never invents an amount/date; they come from the DB.
2. **Compliance Gate before every outreach** — calling hours 9–19, consent, caps, suppression,
   notice clock, borrower/guarantor-only contact. (Values live in `SystemConfig`.)
3. **Verify identity before disclosure** — Aadhaar last-4 (no DOB in the data).
4. **Record every call; log every interaction** with the gate decision.
5. **On-prem / air-gap capable** — clean swap between cloud Sarvam and self-hosted models.
6. **Streaming-first voice** — a 4–5s gap means a non-streaming pipeline. Stream STT→LLM→TTS.

## Key facts learned along the way
- **Stack:** Saaras v3 (ASR, `language="unknown"` → auto language switch), Sarvam-30B (LLM hot
  path) / 105B (complex), Bulbul v3 (TTS, warm female "Asha"; no pitch/loudness on v3).
- **Latency fix:** Twilio `<Record>` = ~4–5s/turn. **Media Streams** (WebSocket) + streaming +
  Silero VAD + barge-in + instant cached **filler** = ~1–2s (Samvaad-like). See folder 6.
- **z.ai = Zhipu GLM, NOT Sarvam.** Fine as a fast fallback (`glm-4.7-flash`), but for Indic +
  lowest latency use **Sarvam-direct** as the live-call LLM. Multi-provider switch in folder 6.
- **Samvaad already does all this** (your console log proved seamless Hindi⇄Marathi⇄English +
  barge-in). If you don't want to hand-build the streaming, configure Samvaad (folder 3) — it also
  offers on-prem/VPC. Benchmark "configure Samvaad" vs "build on Emergent" before over-investing.

## Which path should you take?
- **Improve the app you already have (recommended):** folder **6** — additive, feature-flagged,
  won't disturb the running app. Start with `EMERGENT_INSTRUCTIONS.md`.
- **Use Samvaad hosted:** folder **3** — paste the SKVCB config; least engineering.
- **Rebuild clean full-stack:** folder **5** (React+Python+Postgres) or **4** (via Claude Code).

## Data notes (cause silent bugs if missed)
- No `gender` field → gender-voice defaults to female "Asha".
- No `dob` → verify by **Aadhaar last-4**.
- `Loan.customerId` → `Customer.id` (cuid), not `customerId`. Join on `id`.
- Multiple loans per customer → agent picks the **highest-DPD** loan.
- `consent*` / `suppressionFlags` / `complianceGate` are **stringified JSON** → `json.loads`.
- A few dirty `productType` values → normalise.

## Compliance reminder
The prompt is the **behaviour** layer, not the **security** layer. Always keep the Compliance
Gate (authorises the call before dialing) and the ledger tool-guard doing their jobs, and record
every call. Have a native speaker + your compliance team review the Hindi/Marathi scripts before
go-live.
