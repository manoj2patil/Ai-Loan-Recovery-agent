# Sah-Ayak Full-Stack Voice Agent (React + Python + PostgreSQL)

Turn-by-turn, low-lag loan-recovery voice agent with **mid-call language auto-switching**,
built on the best Sarvam models. React console → FastAPI/LiveKit Python backend → PostgreSQL.

## Why no lag (turn-by-turn)
The backend uses **LiveKit Agents**, which streams the whole loop — STT → LLM → TTS —
continuously, with **Silero VAD** for fast endpointing and **barge-in** (the borrower can
interrupt and the agent stops instantly). This is the ~0.5–1.5s/turn path, not the
record-then-wait (~4–5s) pattern.

## Mid-call language auto-switch
- ASR (`saaras:v3`) runs with `language="unknown"` → detects the spoken language every turn
  and handles Hinglish/code-mixing.
- `agent.py → maybe_switch_language()` debounces (2 sustained turns) then updates the TTS
  target language on the fly, keeping the same-gender voice. The LLM already replies in the
  borrower's language.

## Best Sarvam models (set in `backend/config.py`)
- **ASR:** `saaras:v3` (auto-detect + code-mixing)
- **LLM:** `sarvam-30b` (fast hot path, tool-calling); `sarvam-105b` for complex negotiation
- **TTS:** `bulbul:v3`, warm female voice "Asha" (do NOT set pitch/loudness on v3 — 400 error)

## Layout
```
backend/   FastAPI + LiveKit agent (Python)
  config.py    model + voice config
  db.py        PostgreSQL access → borrower profile (ledger)
  prompts.py   Asha system prompt (rules + response playbook + dynamic facts)
  agent.py     LiveKit voice agent: streaming, mid-call lang switch, tools
  server.py    REST (borrowers, place-call w/ gate) + live WS
frontend/  React (Vite) console: borrower list, Call, live transcript + language
```

## Database (PostgreSQL — recommended over MongoDB)
Your loan data is relational (Customer→Loan→Installment→Guarantor) and your export is
PostgreSQL-shaped, so use **PostgreSQL 16 + pgvector**.

1. Create DB: `createdb sahayak`
2. Load the schema + seed from `database-backup.json` (use your Prisma schema/seed, or a small
   loader script). Tables expected by `db.py`: Customer, Loan, Guarantor, SystemConfig, InteractionLog.
3. Set `DATABASE_URL` in `backend/.env`.

## Run
**Backend (two processes):**
```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill LIVEKIT_*, SARVAM_API_KEY, DATABASE_URL, SIP_TRUNK_ID

# 1) the agent worker (handles the voice session)
python agent.py dev
# or test locally with mic, no phone:
python agent.py console

# 2) the API server (React talks to this)
uvicorn server:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend && npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000
npm run dev            # open the printed URL
```

Click **Call** on a borrower → the server runs the compliance gate → dispatches the agent →
live status/transcript stream into the console.

## Production TODOs
- Wire `server.py` dispatch to your **LiveKit SIP + Twilio** trunk (pseudocode included) and
  pass the borrower phone as job metadata.
- Replace the minimal gate in `server.py` with the full Compliance Gate (consent, suppression,
  per-day caps from `InteractionLog`, notice clock).
- Publish agent events (transcript/lang/tool/status) to Redis pub/sub keyed by call_id and have
  the `/ws/call/{id}` endpoint forward them (placeholder currently echoes).
- Start LiveKit **Egress** to record calls; persist `VoiceCall` + `InteractionLog`.
- Confirm `tts.update_options(...)` / event field names against your installed
  `livekit-plugins-sarvam` version (API evolves) — adjust `maybe_switch_language` if needed.
- Run amounts through a number-to-words helper before TTS.
```
