"""agent.py — LiveKit + Sarvam loan-recovery voice agent.

TURN-BY-TURN, NO-LAG: LiveKit streams STT→LLM→TTS continuously; Silero VAD gives fast
endpointing + barge-in (borrower can interrupt; agent stops instantly).

MID-CALL LANGUAGE AUTO-SWITCH: Saaras ASR runs with language="unknown" (auto-detect +
code-mixing). When the detected language changes for a sustained turn, we update the TTS
target language on the fly (keeping the same-gender voice). The LLM already replies in the
borrower's language.

Best models (config.py): ASR saaras:v3, LLM sarvam-30b, TTS bulbul:v3 (female "Asha").
"""

import logging

from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, function_tool, RunContext
from livekit.plugins import sarvam, silero

import db
from config import ASR_MODEL, LLM_HOT, TTS_MODEL, TTS_PACE, pick_voice
from prompts import build_instructions

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agent")


class CollectionAgent(Agent):
    def __init__(self, profile: dict) -> None:
        self._profile = profile
        self._verified = False
        self._lang = profile["language"]
        self._voice = pick_voice(profile.get("gender"))
        self._switch_streak = {}  # debounce language switching
        super().__init__(
            instructions=build_instructions(profile),
            # language="unknown" → auto-detect each utterance (enables mid-call switch + Hinglish)
            stt=sarvam.STT(model=ASR_MODEL, language="unknown"),
            llm=sarvam.LLM(model=LLM_HOT),
            tts=sarvam.TTS(model=TTS_MODEL, target_language_code=self._lang,
                           speaker=self._voice, pace=TTS_PACE),
            vad=silero.VAD.load(),
        )

    async def on_enter(self) -> None:
        # Phase A: scripted disclosure (fixed wording), spoken before the LLM takes over.
        bank, name = self._profile["bank"], self._profile["name"]
        line = {
            "hi-IN": f"नमस्ते, क्या मेरी बात {name} जी से हो रही है? मैं 'आशा', {bank} की डिजिटल सहायक। "
                     f"यह कॉल रिकॉर्ड हो रही है। पुष्टि के लिए कृपया अपने आधार के अंतिम चार अंक बताइए।",
            "mr-IN": f"नमस्कार, मी {name} यांच्याशी बोलत आहे का? मी 'आशा', {bank} ची डिजिटल सहाय्यक. "
                     f"हा कॉल रेकॉर्ड होत आहे. कृपया तुमच्या आधारचे शेवटचे चार अंक सांगा.",
        }.get(self._lang,
              f"Namaste, am I speaking with {name}? I'm Asha, a digital assistant from {bank}. "
              f"This call is recorded. Please confirm the last four digits of your Aadhaar.")
        await self.session.say(line, allow_interruptions=True)

    # ---- mid-call language auto-switch -------------------------------------
    async def maybe_switch_language(self, detected: str | None) -> None:
        if not detected or detected == self._lang:
            self._switch_streak = {}
            return
        # debounce: require 2 sustained turns in the new language before switching
        self._switch_streak[detected] = self._switch_streak.get(detected, 0) + 1
        if self._switch_streak[detected] < 2:
            return
        log.info("Language switch %s → %s", self._lang, detected)
        self._lang = detected
        self._switch_streak = {}
        try:
            # Update TTS to the new language, same-gender voice. (API may vary by version.)
            self.tts.update_options(target_language_code=detected, speaker=self._voice)
        except Exception as e:  # noqa
            log.warning("tts.update_options not available (%s); rebuild TTS if needed", e)

    # ---- tools (ledger-only) ----------------------------------------------
    @function_tool
    async def verify_identity(self, ctx: RunContext, aadhaar_last4: str) -> str:
        """Verify by the last 4 digits of Aadhaar. Required before any loan detail."""
        given = "".join(c for c in (aadhaar_last4 or "") if c.isdigit())[-4:]
        if given and given == self._profile.get("aadhaar_last4"):
            self._verified = True
            return "MATCH. Identity verified."
        return "NO MATCH. Reveal no loan detail; ask once more or offer a callback."

    @function_tool
    async def get_loan_status(self, ctx: RunContext) -> str:
        """Return CURRENT loan figures from the ledger. Only after verification."""
        if not self._verified:
            return "BLOCKED: not verified."
        ln = self._profile.get("loan") or {}
        return (f"{ln.get('product_type')}, account ending {ln.get('account_last4')}, "
                f"EMI Rs.{ln.get('emi_amount')} due {ln.get('due_date')}, "
                f"pending Rs.{ln.get('pending_amount')}, outstanding Rs.{ln.get('total_outstanding')}, "
                f"{ln.get('pending_installments')} pending, status {ln.get('asset_classification')}.")

    @function_tool
    async def record_promise_to_pay(self, ctx: RunContext, amount: float, date: str) -> str:
        """Record a concrete promise (specific amount AND date)."""
        log.info("PTP %s: %s by %s", self._profile["customer_id"], amount, date)
        return f"Promise recorded: Rs.{amount} by {date}. Confirm it back briefly."

    @function_tool
    async def propose_offer(self, ctx: RunContext) -> str:
        """Return a bank-approved restructuring option (do not invent terms)."""
        # TODO: fetch from approved-offer matrix; placeholder split.
        return "Approved option: split the overdue EMI into 2 smaller monthly parts. Offer this only."

    @function_tool
    async def escalate_to_human(self, ctx: RunContext, reason: str) -> str:
        """Hand off to a human officer."""
        log.info("Escalate %s: %s", self._profile["customer_id"], reason)
        return "Escalation logged. Tell them the team will follow up, then close politely."


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    # phone comes from SIP participant or job metadata (set by the dialer / server.py)
    phone = (ctx.job.metadata or "").strip()
    for p in ctx.room.remote_participants.values():
        phone = p.attributes.get("sip.phoneNumber") or phone
    profile = await db.lookup_borrower(phone)
    if not profile:
        log.warning("Unknown borrower %s", phone)
        return

    agent = CollectionAgent(profile)
    session = AgentSession()

    # Hook transcripts for mid-call language switching.
    @session.on("user_input_transcribed")
    def _on_tx(ev):  # ev has .transcript, .is_final, and (Sarvam) detected language
        if getattr(ev, "is_final", False):
            lang = getattr(ev, "language", None)
            ctx.add_task(agent.maybe_switch_language(lang))  # type: ignore

    await session.start(agent=agent, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
