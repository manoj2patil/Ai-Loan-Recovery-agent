"""server.py — FastAPI backend. REST for the React console + dispatch the voice agent.

Endpoints:
  GET  /api/borrowers          → list borrowers (for the console)
  GET  /api/borrower/{phone}   → full profile (ledger)
  POST /api/call               → compliance gate → place outbound call → dispatch agent
  WS   /ws/call/{call_id}      → live transcript/status to the UI
"""

import os
import logging
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("server")

app = FastAPI(title="Sah-Ayak Voice Agent API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class CallRequest(BaseModel):
    phone: str
    test_mode: bool = False


@app.get("/api/borrowers")
async def borrowers():
    return await db.list_borrowers()


@app.get("/api/borrower/{phone}")
async def borrower(phone: str):
    return await db.lookup_borrower(phone) or {"error": "not found"}


async def compliance_gate(profile: dict, channel: str, test_mode: bool) -> tuple[bool, str]:
    """Minimal gate — extend with full rules (see compliance.py in the build spec)."""
    if test_mode:
        return True, "test_mode"
    # voice consent + suppression checks would read Customer.consentVoice / suppressionFlags
    start = int(await db.get_config("CALLING_HOURS_START", 9))
    end = int(await db.get_config("CALLING_HOURS_END", 19))
    from datetime import datetime
    hour = datetime.now().hour  # TODO: borrower-local time
    if not (start <= hour < end):
        return False, f"outside_calling_hours ({start}-{end})"
    # TODO: per-day frequency caps from InteractionLog, suppression flags, consent
    return True, "allow"


@app.post("/api/call")
async def place_call(req: CallRequest):
    profile = await db.lookup_borrower(req.phone)
    if not profile:
        return {"ok": False, "error": "borrower not found"}

    ok, reason = await compliance_gate(profile, "voice", req.test_mode)
    if not ok:
        return {"ok": False, "gate": reason}

    # Dispatch the LiveKit agent + place the outbound SIP (Twilio) call.
    # The agent reads the phone from job metadata to load the profile.
    # ---- LiveKit dispatch + SIP outbound (pseudocode; wire to your trunk) ----
    # from livekit import api
    # lkapi = api.LiveKitAPI(os.getenv("LIVEKIT_URL"), os.getenv("LIVEKIT_API_KEY"),
    #                        os.getenv("LIVEKIT_API_SECRET"))
    # room = f"call-{profile['customer_id']}"
    # await lkapi.agent_dispatch.create_dispatch(
    #     api.CreateAgentDispatchRequest(agent_name="collection-agent", room=room,
    #                                    metadata=req.phone))
    # await lkapi.sip.create_sip_participant(api.CreateSIPParticipantRequest(
    #     sip_trunk_id=os.getenv("SIP_TRUNK_ID"), sip_call_to=req.phone, room_name=room))
    log.info("Dispatching call to %s (lang=%s)", req.phone, profile["language"])
    return {"ok": True, "gate": reason, "borrower": profile["name"],
            "language": profile["language"], "call_id": f"call-{profile['customer_id']}"}


@app.websocket("/ws/call/{call_id}")
async def call_ws(ws: WebSocket, call_id: str):
    """Live transcript/status feed for the UI.

    Wire this to the agent's events (transcript, language switch, tool calls, status).
    A clean pattern: agent publishes events to Redis pub/sub keyed by call_id; this WS
    subscribes and forwards. Placeholder below sends a heartbeat.
    """
    await ws.accept()
    try:
        await ws.send_json({"type": "status", "call_id": call_id, "state": "connected"})
        # TODO: subscribe to agent events (Redis) and forward {type:'transcript'|'lang'|'status'}
        while True:
            data = await ws.receive_text()
            await ws.send_json({"type": "echo", "data": data})
    except Exception:
        pass
