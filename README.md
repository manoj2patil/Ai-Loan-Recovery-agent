# Sah-Ayak — AI Loan-Recovery Conversational Agent

An on-premises-capable, RBI-compliant, multilingual **voice + WhatsApp loan-recovery agent**
built for Sahakar Krishi Vikas Cooperative Bank (SKVCB), on
**Saaras (ASR) + Bulbul (TTS) + Sarvam-30B/105B (LLM)** with Twilio telephony.

**Start here → [`00-START-HERE.md`](00-START-HERE.md)** — the reading order, the 6 non-negotiable
rules, key stack facts, and which build path to take.

## Repository layout

| Folder | Contents |
|---|---|
| [`01-strategy-and-planning/`](01-strategy-and-planning/) | Full plan, competitive landscape, hardware spec, BA user stories, QA transcripts, production stack guide |
| [`02-data-and-schema/`](02-data-and-schema/) | CBS export (`database-backup.json`, synthetic/masked) + `SCHEMA.md` |
| [`03-prompts-and-config/`](03-prompts-and-config/) | Hardened **Asha** system prompt + **Samvaad** agent config |
| [`04-claude-code-build/`](04-claude-code-build/) | `CLAUDE.md` + step-by-step build prompts + reference code |
| [`05-fullstack-app/`](05-fullstack-app/) | React + Python (FastAPI/LiveKit) + PostgreSQL app scaffold |
| [`06-emergent-lowlatency-addon/`](06-emergent-lowlatency-addon/) | Non-destructive low-latency voice upgrade: Twilio Media Streams, filler, barge-in, multi-LLM |
| [`07-python-livekit-pilot/`](07-python-livekit-pilot/) | Minimal LiveKit + Sarvam pilot wired to the real data |
| [`08-v2-gap-modules/`](08-v2-gap-modules/) | v2 enterprise gap modules — payments, legal tracker, field visits, DND scrub — see [`ROADMAP_V2.md`](08-v2-gap-modules/ROADMAP_V2.md) and [`V2_INTEGRATION.md`](08-v2-gap-modules/V2_INTEGRATION.md) |

## The 6 non-negotiable rules

1. **Ledger-only figures** — the LLM never invents an amount or date; they come from the DB.
2. **Compliance Gate before every outreach** — calling hours 9–19, consent, caps, suppression,
   notice clock, borrower/guarantor-only contact.
3. **Verify identity before disclosure** — Aadhaar last-4.
4. **Record every call; log every interaction** with the gate decision.
5. **On-prem / air-gap capable** — clean swap between cloud Sarvam and self-hosted models.
6. **Streaming-first voice** — stream STT→LLM→TTS; target ~1–2 s per turn.

## Roadmap status

- **Phases 1–5 (v1):** built — data & compliance spine, voice pipeline, orchestration & escalation,
  intelligence layer, scale & governance.
- **v2 ★ gap items:** payments closure, DND scrub, legal case tracker, field collections, NACH
  mandate view — code and integration guide in [`08-v2-gap-modules/`](08-v2-gap-modules/).
