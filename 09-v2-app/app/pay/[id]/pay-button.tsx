"use client";

import { useState } from "react";

export default function PayButton({ linkId }: { linkId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function pay() {
    setState("busy");
    const res = await fetch("/api/payments/sandbox-pay", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId }),
    });
    setState(res.ok ? "done" : "error");
  }

  if (state === "done")
    return <p className="text-center text-sm text-emerald-700">✅ Payment received — receipt sent on WhatsApp.</p>;
  return (
    <button onClick={pay} disabled={state === "busy"}
      className="w-full rounded border border-emerald-600 text-emerald-700 py-2 text-sm disabled:opacity-50">
      {state === "busy" ? "Processing…" : state === "error" ? "Failed — retry" : "Pay now (sandbox)"}
    </button>
  );
}
