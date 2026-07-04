# Sarvam + LiveKit Loan-Recovery Agent — Pilot Starter (Path B)

A runnable starting point for the on-prem-capable AI loan-recovery voice agent, using
**LiveKit Agents + Sarvam** (Saaras v3 STT, sarvam-105b LLM, Bulbul v3 TTS, Silero VAD)
with **Twilio** telephony. It demonstrates the design decisions from the build spec:
scripted compliance opening, gender-matched voice, auto language detection, ledger-only
figures via tools, and streaming-first (low-lag) conversation.

> This is a PILOT scaffold. Items marked `[TODO]` must be completed before production
> (Compliance Gate, real CBS lookup, call recording, dynamic output-language switching).

---

## 1. Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in LIVEKIT_* and SARVAM_API_KEY
```

## 2. Run & test locally (no phone needed)

```bash
# Console mode: talk to the agent from your terminal/mic
python collection_agent.py console
```

Or run as a worker that handles LiveKit rooms (used for telephony):

```bash
python collection_agent.py dev
```

The agent now loads the **real CBS export** (`database-backup.json`) via `data_loader.py` —
64 customers, 131 loans, guarantors, and `SystemConfig` (bank name, calling hours, thresholds).
It looks up a borrower by phone and falls back to a real sample number. Identity is verified
by **Aadhaar last-4** (there is no DOB in the data). See `SCHEMA.md` and `AGENT_HANDOFF.md`.

## 3. Twilio wiring (telephony)

The agent itself is transport-agnostic — calls reach it through **LiveKit SIP**, which
bridges Twilio. High level:

1. **Buy/keep a Twilio number** and note your Twilio SIP credentials.
2. In **LiveKit**, create an **inbound SIP trunk** (for borrower-initiated calls) and/or
   an **outbound SIP trunk** (for the dialer) pointing at Twilio. (LiveKit docs → Telephony / SIP.)
3. Create a **dispatch rule** so incoming SIP calls start an agent session in a room.
4. For **outbound** recovery calls, your dialer (after the Compliance Gate says ALLOW)
   triggers a LiveKit outbound SIP call and dispatches this agent into the room.
5. The caller's phone number arrives as a participant attribute (e.g. `sip.phoneNumber`);
   `entrypoint()` reads it to look up the borrower. Confirm the exact attribute for your
   setup and adjust if needed.

**WhatsApp:** run reminders through the WhatsApp Business API (or Sarvam Samvaad's
omnichannel) as a separate service that shares the same borrower context/DB. Keep WhatsApp
to Utility templates (reminders/links), not late-stage dunning.

---

## 4. What this starter already does

- **Scripted opening (Phase A):** `on_enter()` speaks the exact disclosure + recording
  notice + DOB request via `session.say()` — not LLM-generated — in the borrower's language.
- **Identity-gated loan details:** `get_loan_status` refuses to return figures until
  `verify_identity` matches. The LLM cannot leak the loan before verification.
- **Ledger-only figures:** all amounts come from the `get_loan_status` tool, never the LLM.
- **Gender-matched voice:** `select_voice()` picks a male/female Bulbul speaker from the
  borrower's gender (female default = "Asha").
- **Auto language detection:** Saaras `language="unknown"` handles Hindi/Marathi/English +
  Hinglish input automatically.
- **Streaming + barge-in (anti-lag):** LiveKit streams STT→LLM→TTS; Silero VAD gives fast
  endpointing and interruption, so turns feel real-time (~0.5–1.5s), not 10–15s.
- **Compliant behaviour:** short turns, empathy, off-topic redirect, never asks for OTP/PIN,
  escalates disputes/hardship/distress.

## 5. Production TODOs (before go-live)

- [ ] **Compliance Gate:** the outbound dialer must check calling hours (08:00–19:00),
      consent, frequency caps, notice clock, and suppression BEFORE dialing. The agent
      assumes ALLOW.
- [ ] **Real CBS lookup:** replace `mock_data.lookup_borrower()` with a read-only query to
      your recovery store (fed from CBS). Keep figures ledger-sourced.
- [ ] **Call recording (mandatory):** start LiveKit **Egress** at the top of `entrypoint()`
      and store the recording in MinIO with a reference in `interaction_log`.
- [ ] **Dynamic output-language switch:** when the detected input language changes
      mid-call, update the TTS language (and keep the same-gender voice) so the spoken
      reply matches. (Input auto-detect already works via Saaras.)
- [ ] **Disposition + memory:** persist outcome (ptp/dispute/paid/hardship/dnc), write the
      interaction log, and store a conversation summary for next-call context.
- [ ] **Female-agent rule:** enforce female voice for female borrowers (already defaulted).
- [ ] **Lower-latency model option:** benchmark a smaller Sarvam model on the hot path vs
      sarvam-105b; escalate to 105b only for complex negotiation.
- [ ] **Air-gap option:** to remove the cloud dependency, swap the Sarvam cloud plugins for
      self-hosted models (Path C: SGLang + IndicConformer + Indic Parler-TTS).

## 6. Anti-lag reminders (keep it streaming-first)

- Never collect full audio → full ASR → full LLM → full TTS sequentially.
- Keep Silero VAD endpointing tight (~300–500ms silence).
- Stream LLM tokens; let TTS start on the first clause.
- Keep services in-region; keep workers warm.

## 7. Notes

- The Hindi/Marathi disclosure scripts in `mock_data.py` are drafts — have a native speaker
  and your compliance team review them before recording real calls.
- Pin dependency versions once running; the LiveKit Agents API changes across releases.
- References: Sarvam Collection-Agent (LiveKit) and Loan-Advisory (Pipecat) cookbooks;
  LiveKit Agents + SIP docs.
