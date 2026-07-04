# DEPLOY.md — Low-Latency Voice Add-On (non-destructive)

This add-on runs ALONGSIDE your existing app. Nothing in your current flow changes unless you
turn the flag on.

## Files
- `media-stream-server.ts` — standalone real-time bridge (persistent process; NOT serverless)
- `sarvam-streaming.ts` — streaming LLM + TTS + STT
- `conversation-manager.ts` — filler + sentence-streaming + barge-in
- `audio.ts` — μ-law <-> PCM, resample, WAV, VAD
- `filler-pregen.ts` — pre-generate cached filler audio at boot
- `fillers.json` — backchannel phrases per language
- `inbound-route.ts` — NEW feature-flagged TwiML route (falls back to your existing flow)

## Env additions (add to .env; do not change existing keys)
```
USE_MEDIA_STREAMS=false           # master flag; keep false in prod until tested
MEDIA_STREAM_TEST_NUMBERS=        # optional: comma-sep numbers to route through the new path
MEDIA_HOST=wss://media.YOUR_DOMAIN # public wss host of the media server
MEDIA_STREAM_PORT=3001
SARVAM_API_KEY=...                # (already have)
SARVAM_LLM_MODEL=sarvam-30b
SARVAM_TTS_MODEL=bulbul:v3
SARVAM_TTS_VOICE=anushka
SARVAM_ASR_MODEL=saaras:v2
```

## Run the media server (on an always-on host — on-prem App server or a small VM)
```bash
npm i ws                          # (only dep beyond your app)
# build/transpile the .ts files, then:
node media-stream-server.js
# or with Bun: bun media-stream-server.ts
```
Put it behind Nginx with TLS so Twilio can reach `wss://media.YOUR_DOMAIN/media`.
At boot it calls pregenFillers() to warm the filler cache.

### systemd (example)
```
[Unit]
Description=Sah-Ayak media stream server
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/sahayak/media-stream-server.js
Restart=always
EnvironmentFile=/opt/sahayak/.env
[Install]
WantedBy=multi-user.target
```

## Point Twilio at the new route (only for the test number, to be safe)
Set the test number's Voice webhook to `/api/voice/inbound-stream`, or add
`MEDIA_STREAM_TEST_NUMBERS=+91...` so only that number streams while everything else is unchanged.

## Test
1. Flag OFF → confirm the app behaves EXACTLY as before (regression).
2. Add your test number to MEDIA_STREAM_TEST_NUMBERS → call it → expect:
   - ~1–2s per turn, instant filler ("अच्छा…") then the reply
   - barge-in (you interrupt, agent stops)
   - Hindi/Marathi/English mid-call switching
   - stays on loan topics; figures from DB

## Rollback (instant)
- Set `USE_MEDIA_STREAMS=false` and clear `MEDIA_STREAM_TEST_NUMBERS` → 100% back to the old path.
- Or delete the `lowlatency-voice` branch. No existing code was modified.

## Notes / verify against current Sarvam docs
- Exact model strings and TTS request body ("text" vs "inputs", `audios` response key) can change —
  confirm in the Sarvam dashboard. The code marks these spots.
- For the strongest turn-taking, swap the simple energy VAD in `audio.ts` for **Silero VAD**.
- STT here is batch-on-endpoint (reliable + the filler hides the gap). Upgrade to streaming STT if
  you need partials.
