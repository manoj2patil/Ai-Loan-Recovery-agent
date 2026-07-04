"""config.py — Sarvam model choices for the loan-recovery agent + voice map.

Best-for-loan-recovery picks:
  ASR : saaras:v3   (language="unknown" → auto-detect + code-mixing → mid-call switch)
  LLM : sarvam-30b  (fast hot path, tool-calling) ; sarvam-105b for complex negotiation
  TTS : bulbul:v3   (warm female persona "Asha"; do NOT set pitch/loudness on v3)
"""

# --- Models ---
ASR_MODEL = "saaras:v3"
LLM_HOT = "sarvam-30b"        # every call
LLM_COLD = "sarvam-105b"      # complex negotiation only
TTS_MODEL = "bulbul:v3"

TTS_PACE = 0.9                # slightly slower for phone clarity (no pitch/loudness on v3)

# Gender-matched voice (Bulbul v3). Customer table has no gender → default female "Asha".
VOICE_MAP = {"female": "anushka", "male": "abhilash", "default": "anushka"}

# preferredLanguage code (from CBS) → Sarvam language code.
LANG_MAP = {
    "hi": "hi-IN", "mr": "mr-IN", "ta": "ta-IN", "te": "te-IN", "kn": "kn-IN",
    "ml": "ml-IN", "gu": "gu-IN", "pa": "pa-IN", "bn": "bn-IN", "en": "en-IN", "od": "od-IN",
}

def to_sarvam_lang(code: str) -> str:
    return LANG_MAP.get((code or "en").split("-")[0], "en-IN")

def pick_voice(gender: str | None) -> str:
    return VOICE_MAP.get((gender or "").lower(), VOICE_MAP["default"])
