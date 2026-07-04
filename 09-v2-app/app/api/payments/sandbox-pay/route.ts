// POST /api/payments/sandbox-pay — SANDBOX ONLY. Plays the role of the payment gateway:
// takes a link id, constructs the PG webhook event, signs it with the shared secret, and
// POSTs it to our own /api/payments/webhook. Lets the /pay page demonstrate the full
// link → webhook → suppression → PTP KEPT → receipt flow without a real PG.
// Remove (or gate behind NODE_ENV) before production.

import { NextResponse } from "next/server";
import { signWebhookBody } from "@/lib/payments";
import { findPaymentLink } from "@/lib/db";

export async function POST(req: Request) {
  const { linkId } = await req.json();
  const link = findPaymentLink(linkId);
  if (!link) return NextResponse.json({ error: "link not found" }, { status: 404 });

  const body = JSON.stringify({
    tr: link.id,
    amount: link.amount,
    utr: "UTR" + Math.random().toString().slice(2, 14),
    paidAt: new Date().toISOString(),
  });
  const res = await fetch(new URL("/api/payments/webhook", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-signature": signWebhookBody(body) },
    body,
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
