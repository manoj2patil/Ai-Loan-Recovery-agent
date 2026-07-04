"""db.py — PostgreSQL access (asyncpg). Returns a normalized borrower profile.

Assumes the schema/data from database-backup.json is loaded into PostgreSQL
(see schema.sql / your Prisma seed). Tables: Customer, Loan, Guarantor, etc.
Figures returned here are the LEDGER — the LLM never invents them.
"""

import json
import os
from datetime import datetime
import asyncpg

from config import to_sarvam_lang

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://sahayak:pass@localhost:5432/sahayak")
_pool: asyncpg.Pool | None = None


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    return _pool


def _fmt_date(dt) -> str:
    if isinstance(dt, datetime):
        return f"{dt.day} {dt.strftime('%B %Y')}"
    return str(dt or "")


def _dpd_bucket(dpd: int | None) -> str:
    dpd = dpd or 0
    if dpd <= 30: return "0-30"
    if dpd <= 60: return "30-60"
    if dpd <= 90: return "60-90"
    return "90+"


async def get_config(key: str, default=None):
    p = await pool()
    row = await p.fetchrow('SELECT value FROM "SystemConfig" WHERE key = $1', key)
    return row["value"] if row else default


async def list_borrowers(limit: int = 50):
    """For the frontend list: borrowers with their highest-DPD loan."""
    p = await pool()
    rows = await p.fetch(
        '''
        SELECT DISTINCT ON (c.id) c.id, c."customerId", c.name, c.phone,
               c."preferredLanguage", l."loanId", l."pendingAmount", l.dpd,
               l."assetClassification", l."productType"
        FROM "Customer" c JOIN "Loan" l ON l."customerId" = c.id
        ORDER BY c.id, l.dpd DESC
        LIMIT $1
        ''', limit,
    )
    return [dict(r) for r in rows]


async def lookup_borrower(phone: str) -> dict | None:
    """Normalized profile the voice agent needs, keyed by phone."""
    p = await pool()
    c = await p.fetchrow(
        'SELECT * FROM "Customer" WHERE phone = $1 OR "altPhone" = $1', phone
    )
    if not c:
        return None

    loan = await p.fetchrow(
        'SELECT * FROM "Loan" WHERE "customerId" = $1 ORDER BY dpd DESC LIMIT 1', c["id"]
    )
    guarantor = None
    if loan:
        guarantor = await p.fetchrow(
            'SELECT * FROM "Guarantor" WHERE "linkedLoanId" = $1 LIMIT 1', loan["id"]
        )

    aadhaar = (c["maskedAadhaar"] or "").replace("-", "")
    bank = await get_config("BANK_NAME", "your bank")

    profile = {
        "customer_id": c["customerId"],
        "name": c["name"],
        "gender": None,  # not in CBS export → female persona default
        "phone": c["phone"],
        "language": to_sarvam_lang(c["preferredLanguage"]),
        "bank": bank,
        "aadhaar_last4": aadhaar[-4:] if len(aadhaar) >= 4 else "",
        "loan": None,
        "guarantor": dict(guarantor) if guarantor else None,
    }
    if loan:
        lid = loan["loanId"] or ""
        profile["loan"] = {
            "loan_id": lid,
            "account_last4": lid[-4:],
            "product_type": loan["productType"],
            "emi_amount": loan["emiAmount"],
            "due_date": _fmt_date(loan["nextDueDate"]),
            "pending_amount": loan["pendingAmount"],
            "total_outstanding": loan["totalOutstanding"],
            "pending_installments": loan["pendingInstallments"],
            "dpd": loan["dpd"],
            "dpd_bucket": _dpd_bucket(loan["dpd"]),
            "asset_classification": loan["assetClassification"],
        }
    return profile


async def log_interaction(profile: dict, outcome: str, transcript: str, language: str):
    """Persist the call outcome (InteractionLog). Fire-and-forget from the agent."""
    p = await pool()
    await p.execute(
        '''INSERT INTO "InteractionLog"
           (id, "customerId", "loanId", channel, direction, language, outcome, transcript, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, 'VOICE', 'OUTBOUND', $3, $4, $5, now())''',
        profile["customer_id"], (profile.get("loan") or {}).get("loan_id"),
        language, outcome, transcript,
    )
