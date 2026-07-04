// POST /api/payments/webhook — PG/UPI callback. The provider signature over the RAW body
// is verified before anything is trusted; mismatches are rejected. Idempotent.

import { NextResponse } from "next/server";
import { handlePaymentWebhook, verifyWebhookSignature } from "@/lib/payments";

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyWebhookSignature(rawBody, req.headers.get("x-webhook-signature")))
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });

  let evt: { tr?: string; reference?: string; amount: number | string; utr?: string; paidAt?: string };
  try { evt = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const result = await handlePaymentWebhook({
    reference: evt.tr || evt.reference || "",
    amountPaid: Number(evt.amount),
    utr: evt.utr,
    paidAt: evt.paidAt || new Date().toISOString(),
  });
  return NextResponse.json(result);
}
