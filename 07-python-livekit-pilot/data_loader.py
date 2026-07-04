"""
data_loader.py — loads the real CBS backup (database-backup.json) and exposes
the borrower profile + config the voice agent needs.

This REPLACES the earlier mock_data.py. It reads the actual exported tables
(Customer, Loan, Installment, Guarantor, SystemConfig, ...), joins them, parses
the JSON-string fields (consent, suppression, compliance), and returns a
normalized profile keyed by phone number.

GOLDEN RULE: figures returned here come from the ledger (the export). The LLM
must never invent amounts — it calls get_loan_status which reads this.
"""

import json
import os
from datetime import datetime
from functools import lru_cache

DATA_PATH = os.getenv(
    "DATA_BACKUP_PATH",
    os.path.join(os.path.dirname(__file__), "database-backup.json"),
)

# preferredLanguage codes in the data → Sarvam (Saaras/Bulbul) language codes.
LANG_MAP = {
    "hi": "hi-IN", "mr": "mr-IN", "ta": "ta-IN", "te": "te-IN",
    "kn": "kn-IN", "ml": "ml-IN", "gu": "gu-IN", "pa": "pa-IN",
    "bn": "bn-IN", "en": "en-IN", "od": "od-IN",
}

# Bulbul v3 speaker pools, chosen by borrower gender.
# NOTE: the Customer table has NO gender field, so we default to a female
# persona ("Asha"). See get_voice() and the [TODO] in the handoff doc.
VOICE_MAP = {"female": "priya", "male": "aditya", "default": "priya"}

# Scripted Phase-A opening. Verification uses the LAST 4 OF AADHAAR (there is no
# DOB in the data). hi/mr/en are drafted; others fall back to en-IN until native
# scripts are added (see [TODO]).
DISCLOSURE = {
    "en-IN": ("Namaste, am I speaking with {name}? I'm Asha, a digital assistant "
              "calling on behalf of {bank} about your loan account. This call is "
              "recorded for quality and compliance. Before we continue, could you "
              "please confirm the last four digits of your Aadhaar number?"),
    "hi-IN": ("नमस्ते, क्या मेरी बात {name} जी से हो रही है? मैं 'आशा' हूँ, {bank} की ओर से "
              "आपके लोन खाते के बारे में बात करने वाली एक डिजिटल सहायक। यह कॉल गुणवत्ता और "
              "अनुपालन के लिए रिकॉर्ड की जा रही है। आगे बढ़ने से पहले, कृपया अपने आधार के "
              "अंतिम चार अंक बताइए।"),
    "mr-IN": ("नमस्कार, मी {name} यांच्याशी बोलत आहे का? मी 'आशा', {bank} तर्फे तुमच्या कर्ज "
              "खात्याबद्दल बोलणारी एक डिजिटल सहाय्यक. हा कॉल गुणवत्ता आणि अनुपालनासाठी रेकॉर्ड "
              "केला जात आहे. पुढे जाण्यापूर्वी, कृपया तुमच्या आधारचे शेवटचे चार अंक सांगा."),
}


def _parse_json(s, default=None):
    if not s:
        return default
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return default


def _fmt_date(iso):
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return f"{d.day} {d.strftime('%B %Y')}"
    except Exception:
        return iso


def _dpd_bucket(dpd):
    dpd = dpd or 0
    if dpd <= 30:
        return "0-30"
    if dpd <= 60:
        return "30-60"
    if dpd <= 90:
        return "60-90"
    return "90+"


@lru_cache(maxsize=1)
def _db():
    with open(DATA_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    # Build indexes once.
    customers_by_phone = {}
    for c in raw.get("Customer", []):
        if c.get("phone"):
            customers_by_phone[c["phone"]] = c
        if c.get("altPhone"):
            customers_by_phone[c["altPhone"]] = c
    loans_by_customer = {}
    for l in raw.get("Loan", []):
        loans_by_customer.setdefault(l["customerId"], []).append(l)
    guarantors_by_loan = {}
    for g in raw.get("Guarantor", []):
        guarantors_by_loan.setdefault(g.get("linkedLoanId"), []).append(g)
    config = {r["key"]: r["value"] for r in raw.get("SystemConfig", [])}
    return {
        "customers_by_phone": customers_by_phone,
        "loans_by_customer": loans_by_customer,
        "guarantors_by_loan": guarantors_by_loan,
        "config": config,
    }


def get_config(key, default=None):
    """Read a SystemConfig value (bank name, calling hours, thresholds, etc.)."""
    return _db()["config"].get(key, default)


def get_voice(gender):
    return VOICE_MAP.get((gender or "").lower(), VOICE_MAP["default"])


def _pick_loan(loans):
    """Pick the most relevant loan for a recovery call: highest DPD (most overdue)."""
    if not loans:
        return None
    return sorted(loans, key=lambda l: (l.get("dpd") or 0), reverse=True)[0]


def lookup_borrower(phone):
    """Return a normalized borrower profile for the voice agent, or None."""
    db = _db()
    c = db["customers_by_phone"].get(phone)
    if not c:
        return None

    loans = db["loans_by_customer"].get(c["id"], [])
    loan = _pick_loan(loans)
    guarantors = db["guarantors_by_loan"].get(loan["id"], []) if loan else []

    lang = LANG_MAP.get(c.get("preferredLanguage", "en"), "en-IN")
    aadhaar = (c.get("maskedAadhaar") or "").replace("-", "")
    aadhaar_last4 = aadhaar[-4:] if len(aadhaar) >= 4 else ""

    profile = {
        "customer_pk": c["id"],
        "customer_id": c.get("customerId"),
        "name": c.get("name"),
        "gender": None,  # not in CBS export — defaults to female persona
        "phone": c.get("phone"),
        "preferred_language": lang,
        "bank": get_config("BANK_NAME", "your bank"),
        "verify": {"aadhaar_last4": aadhaar_last4, "pan": c.get("maskedPan")},
        "consent": {
            "sms": (_parse_json(c.get("consentSms"), {}) or {}).get("granted", False),
            "whatsapp": (_parse_json(c.get("consentWhatsapp"), {}) or {}).get("granted", False),
            "voice": (_parse_json(c.get("consentVoice"), {}) or {}).get("granted", False),
        },
        "suppression": _parse_json(c.get("suppressionFlags"), {}) or {},
        "loan": None,
        "guarantor": None,
    }

    if loan:
        loan_id = loan.get("loanId", "")
        profile["loan"] = {
            "loan_id": loan_id,
            "account_last4": loan_id[-4:] if loan_id else "",
            "product_type": loan.get("productType"),
            "emi_amount": loan.get("emiAmount"),
            "due_date": _fmt_date(loan.get("nextDueDate")),
            "pending_amount": loan.get("pendingAmount"),
            "total_outstanding": loan.get("totalOutstanding"),
            "pending_installments": loan.get("pendingInstallments"),
            "dpd": loan.get("dpd"),
            "dpd_bucket": _dpd_bucket(loan.get("dpd")),
            "asset_classification": loan.get("assetClassification"),
            "sarfaesi_notice_date": loan.get("sarfaesiNoticeDate"),
        }
    if guarantors:
        g = guarantors[0]
        profile["guarantor"] = {
            "name": g.get("name"),
            "phone": g.get("phone"),
            "relationship": g.get("relationship"),
            "voice_consent": (_parse_json(g.get("consentVoice"), {}) or {}).get("granted", False),
            "escalation_status": g.get("escalationStatus"),
        }
    return profile


def sample_phones(n=5):
    """Helper: list some real phone numbers from the data for testing."""
    return list(_db()["customers_by_phone"].keys())[:n]
