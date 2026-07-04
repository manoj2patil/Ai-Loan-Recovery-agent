"use client";
// components/V2Sections.tsx — Frontend for the v2 gap modules, matching your app's
// section-with-tabs pattern (like the Intelligence section's 4 tabs).
// Tabs: Payments · Legal Cases · Field Visits. Tailwind, no new deps.

import { useEffect, useState } from "react";

type Tab = "payments" | "legal" | "field";

export default function V2Sections() {
  const [tab, setTab] = useState<Tab>("payments");
  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold mb-3">Payments · Legal · Field (v2)</h2>
      <div className="flex gap-2 mb-4">
        {(["payments", "legal", "field"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm ${tab === t ? "bg-blue-600 text-white" : "bg-slate-100"}`}>
            {t === "payments" ? "Payments" : t === "legal" ? "Legal Cases" : "Field Visits"}
          </button>
        ))}
      </div>
      {tab === "payments" && <PaymentsTab />}
      {tab === "legal" && <LegalTab />}
      {tab === "field" && <FieldTab />}
    </section>
  );
}

/* ---------------- Payments ---------------- */
function PaymentsTab() {
  const [loanId, setLoanId] = useState("");
  const [purpose, setPurpose] = useState("EMI");
  const [amount, setAmount] = useState("");
  const [link, setLink] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function createLink() {
    setBusy(true);
    const res = await fetch("/api/payments/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loanId, purpose, amount: amount ? Number(amount) : undefined }),
    }).then((r) => r.json()).finally(() => setBusy(false));
    setLink(res.link || null);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Generate a secure UPI/payment link (ledger amount for EMI/PTP; capped custom amount for
        settlement/partial). On webhook: auto-suppression, PTP close, receipt.
      </p>
      <div className="flex flex-wrap gap-2">
        <input className="border rounded px-2 py-1.5 text-sm" placeholder="Loan ID"
               value={loanId} onChange={(e) => setLoanId(e.target.value)} />
        <select className="border rounded px-2 py-1.5 text-sm" value={purpose}
                onChange={(e) => setPurpose(e.target.value)}>
          <option>EMI</option><option>PTP</option><option>SETTLEMENT</option><option>PARTIAL</option>
        </select>
        {(purpose === "SETTLEMENT" || purpose === "PARTIAL") && (
          <input className="border rounded px-2 py-1.5 text-sm w-28" placeholder="₹ amount"
                 value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}
        <button onClick={createLink} disabled={busy || !loanId}
                className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
          {busy ? "Creating…" : "Create link"}
        </button>
      </div>
      {link && (
        <div className="rounded border bg-slate-50 p-3 text-sm space-y-1">
          <div>Amount: <b>₹{Number(link.amount).toLocaleString("en-IN")}</b> · expires {new Date(link.expiresAt).toLocaleString()}</div>
          <div className="truncate">Web: <a className="text-blue-600 underline" href={link.webUrl}>{link.webUrl}</a></div>
          <div className="truncate">UPI: <code>{link.upi}</code></div>
          <div className="text-slate-500">Send via WhatsApp (gated) or read out on call.</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Legal ---------------- */
function LegalTab() {
  const [data, setData] = useState<{ cases: any[]; upcoming: any[] }>({ cases: [], upcoming: [] });
  useEffect(() => { fetch("/api/legal/cases").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium text-sm mb-2">Upcoming hearings & statutory deadlines (14 days)</h3>
        {data.upcoming.length === 0 && <p className="text-sm text-slate-500">None in window.</p>}
        <ul className="space-y-1">
          {data.upcoming.map((o: any, i: number) => (
            <li key={i} className="text-sm flex gap-2 items-center">
              <span className={`px-2 py-0.5 rounded-full text-xs ${o.kind === "HEARING" ? "bg-amber-100" : "bg-red-100"}`}>{o.kind}</span>
              <span>{new Date(o.when).toLocaleDateString()}</span><span className="text-slate-600">{o.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium text-sm mb-2">Cases</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500">
            <th>Loan</th><th>Type</th><th>Stage</th><th>Next hearing</th><th>Deadline</th><th>Advocate</th>
          </tr></thead>
          <tbody>
            {data.cases.map((c: any) => (
              <tr key={c.id} className="border-t">
                <td>{c.loanId}</td><td>{c.type}</td>
                <td><span className="px-2 py-0.5 rounded bg-slate-100 text-xs">{c.stage}</span></td>
                <td>{c.nextHearing ? new Date(c.nextHearing).toLocaleDateString() : "—"}</td>
                <td>{c.statutoryDeadline ? new Date(c.statutoryDeadline).toLocaleDateString() : "—"}</td>
                <td>{c.advocateId || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          Stage transitions to filing/possession require legal-role approval — tracked, never auto-executed.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Field ---------------- */
function FieldTab() {
  const [visits, setVisits] = useState<any[]>([]);
  useEffect(() => { fetch("/api/field/visits").then((r) => r.json()).then((d) => setVisits(d.visits || [])).catch(() => {}); }, []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Visits are auto-proposed by the orchestrator (60+ DPD, phone exhausted) and pass the
        Compliance Gate as channel <code>visit</code>. Completion requires a geo-tag; cash requires
        a receipt reference.
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">
          <th>Loan</th><th>Agent</th><th>Scheduled</th><th>Status</th><th>Outcome</th><th>Collected</th>
        </tr></thead>
        <tbody>
          {visits.map((v: any) => (
            <tr key={v.id} className="border-t">
              <td>{v.loanId}</td><td>{v.agentId}</td>
              <td>{new Date(v.scheduledFor).toLocaleString()}</td>
              <td><span className="px-2 py-0.5 rounded bg-slate-100 text-xs">{v.status}</span></td>
              <td>{v.outcome || "—"}</td>
              <td>{v.amountCollected ? `₹${v.amountCollected.toLocaleString("en-IN")}` : "—"}</td>
            </tr>
          ))}
          {visits.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">No visits scheduled.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
