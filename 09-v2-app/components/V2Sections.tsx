"use client";
// components/V2Sections.tsx — console for the v2 gap modules.
// Tabs: Payments · Legal Cases · Field Visits · NACH · Ops. Tailwind, no new deps.
// Dev RBAC: requests carry x-role from the role picker (officer/compliance/admin).

import { useCallback, useEffect, useState } from "react";

type Tab = "payments" | "legal" | "field" | "nach" | "ops";
const TABS: [Tab, string][] = [
  ["payments", "Payments"], ["legal", "Legal Cases"], ["field", "Field Visits"],
  ["nach", "NACH"], ["ops", "Ops"],
];

let ROLE = "officer";

async function api(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-role": ROLE, "x-actor": "console" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export default function V2Sections() {
  const [tab, setTab] = useState<Tab>("payments");
  const [role, setRole] = useState("officer");
  ROLE = role;
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Payments · Legal · Field · NACH (v2)</h2>
        <label className="text-xs text-slate-500">
          role{" "}
          <select className="border rounded px-1 py-0.5" value={role} onChange={(e) => setRole(e.target.value)}>
            <option>officer</option><option>compliance</option><option>admin</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm ${tab === t ? "bg-blue-600 text-white" : "bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "payments" && <PaymentsTab />}
      {tab === "legal" && <LegalTab />}
      {tab === "field" && <FieldTab />}
      {tab === "nach" && <NachTab />}
      {tab === "ops" && <OpsTab />}
    </section>
  );
}

function Err({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-red-700">⚠ {msg}</p> : null;
}

/* ---------------- Payments ---------------- */
function PaymentsTab() {
  const [loanId, setLoanId] = useState("");
  const [purpose, setPurpose] = useState("EMI");
  const [amount, setAmount] = useState("");
  const [link, setLink] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function createLink() {
    setBusy(true); setErr("");
    const res = await api("/api/payments/link", { loanId, purpose, amount: amount ? Number(amount) : undefined });
    setBusy(false);
    if (res.body.link) setLink(res.body.link); else setErr(res.body.error || "failed");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Generate a secure UPI/payment link (ledger amount for EMI/PTP; capped custom amount for
        settlement/partial). On webhook: auto-suppression, PTP close, receipt.
      </p>
      <div className="flex flex-wrap gap-2">
        <input className="border rounded px-2 py-1.5 text-sm" placeholder="Loan ID (e.g. LN500001)"
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
      <Err msg={err} />
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
const STAGES = ["NOTICE_DRAFTED","NOTICE_SERVED","REPLY_WINDOW","POSSESSION_13_4","COMPLAINT_FILED","HEARING","ORDER","SETTLED","CLOSED"];

function LegalTab() {
  const [data, setData] = useState<{ cases: any[]; upcoming: any[] }>({ cases: [], upcoming: [] });
  const [form, setForm] = useState({ loanId: "", type: "SARFAESI", court: "", caseNumber: "", advocateId: "", nextHearing: "" });
  const [err, setErr] = useState("");
  const load = useCallback(() => { api("/api/legal/cases").then((r) => setData(r.body)); }, []);
  useEffect(load, [load]);

  async function create() {
    setErr("");
    const res = await api("/api/legal/cases", { action: "create", ...form, nextHearing: form.nextHearing || undefined });
    if (res.body.ok) { setForm({ ...form, loanId: "" }); load(); } else setErr(res.body.error || "failed");
  }
  async function advance(caseId: string, toStage: string) {
    setErr("");
    const res = await api("/api/legal/cases", { action: "advance", caseId, toStage, note: "via console" });
    if (res.body.ok) load(); else setErr(res.body.error || "failed");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center rounded border bg-slate-50 p-2">
        <input className="border rounded px-2 py-1 text-sm w-32" placeholder="Loan ID" value={form.loanId}
               onChange={(e) => setForm({ ...form, loanId: e.target.value })} />
        <select className="border rounded px-2 py-1 text-sm" value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option>SARFAESI</option><option>SEC_138</option><option>ARBITRATION</option>
        </select>
        <input className="border rounded px-2 py-1 text-sm w-32" placeholder="Court" value={form.court}
               onChange={(e) => setForm({ ...form, court: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-28" placeholder="Case no." value={form.caseNumber}
               onChange={(e) => setForm({ ...form, caseNumber: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-28" placeholder="Advocate" value={form.advocateId}
               onChange={(e) => setForm({ ...form, advocateId: e.target.value })} />
        <input type="date" className="border rounded px-2 py-1 text-sm" value={form.nextHearing}
               onChange={(e) => setForm({ ...form, nextHearing: e.target.value })} />
        <button onClick={create} disabled={!form.loanId}
                className="bg-blue-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50">Open case</button>
      </div>
      <Err msg={err} />
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
            <th>Loan</th><th>Type</th><th>Stage</th><th>Next hearing</th><th>Deadline</th><th>Advocate</th><th></th>
          </tr></thead>
          <tbody>
            {data.cases.map((c: any) => (
              <tr key={c.id} className="border-t">
                <td>{c.loanId}</td><td>{c.type}</td>
                <td><span className="px-2 py-0.5 rounded bg-slate-100 text-xs">{c.stage}</span></td>
                <td>{c.nextHearing ? new Date(c.nextHearing).toLocaleDateString() : "—"}</td>
                <td>{c.statutoryDeadline ? new Date(c.statutoryDeadline).toLocaleDateString() : "—"}</td>
                <td>{c.advocateId || "—"}</td>
                <td>
                  <select className="border rounded text-xs px-1 py-0.5" value=""
                          onChange={(e) => e.target.value && advance(c.id, e.target.value)}>
                    <option value="">advance…</option>
                    {STAGES.filter((s) => s !== c.stage).map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          Transitions to POSSESSION_13_4 / COMPLAINT_FILED require the compliance role — tracked, never auto-executed.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Field ---------------- */
function FieldTab() {
  const [visits, setVisits] = useState<any[]>([]);
  const [form, setForm] = useState({ loanId: "", agentId: "FA01", scheduledFor: "", address: "" });
  const [done, setDone] = useState({ visitId: "", outcome: "PAID", amount: "", receiptRef: "" });
  const [err, setErr] = useState("");
  const load = useCallback(() => { api("/api/field/visits").then((r) => setVisits(r.body.visits || [])); }, []);
  useEffect(load, [load]);

  async function schedule() {
    setErr("");
    const res = await api("/api/field/visits", {
      action: "schedule", ...form,
      scheduledFor: form.scheduledFor || new Date(Date.now() + 86400000).toISOString(),
    });
    if (res.body.ok) load();
    else setErr(res.body.error || (res.body.gate ? `gate: ${res.body.gate.verdict} (${res.body.gate.blockedBy})` : "failed"));
  }
  async function complete() {
    setErr("");
    const res = await api("/api/field/visits", {
      action: "complete", visitId: done.visitId, outcome: done.outcome,
      lat: 11.25, lng: 75.78, // dev stub — production uses the agent app's live GPS fix
      amountCollected: done.amount ? Number(done.amount) : undefined,
      receiptRef: done.receiptRef || undefined,
    });
    if (res.body.ok) { setDone({ ...done, visitId: "" }); load(); } else setErr(res.body.error || "failed");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Scheduling passes the Compliance Gate (channel <code>visit</code>). Completion requires a
        geo-tag; cash requires a receipt reference and flows through the payment-closure path.
      </p>
      <div className="flex flex-wrap gap-2 items-center rounded border bg-slate-50 p-2">
        <input className="border rounded px-2 py-1 text-sm w-32" placeholder="Loan ID" value={form.loanId}
               onChange={(e) => setForm({ ...form, loanId: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-24" placeholder="Agent" value={form.agentId}
               onChange={(e) => setForm({ ...form, agentId: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-64" placeholder="Address" value={form.address}
               onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <button onClick={schedule} disabled={!form.loanId || !form.address}
                className="bg-blue-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50">Schedule visit</button>
      </div>
      <div className="flex flex-wrap gap-2 items-center rounded border bg-slate-50 p-2">
        <select className="border rounded px-2 py-1 text-sm" value={done.visitId}
                onChange={(e) => setDone({ ...done, visitId: e.target.value })}>
          <option value="">complete visit…</option>
          {visits.filter((v) => v.status === "SCHEDULED").map((v) => (
            <option key={v.id} value={v.id}>{v.loanId} · {new Date(v.scheduledFor).toLocaleDateString()}</option>
          ))}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={done.outcome}
                onChange={(e) => setDone({ ...done, outcome: e.target.value })}>
          <option>PAID</option><option>PTP</option><option>DISPUTE</option><option>NOT_FOUND</option>
          <option>REFUSED</option><option>LOCKED</option><option>OTHER</option>
        </select>
        <input className="border rounded px-2 py-1 text-sm w-24" placeholder="₹ collected" value={done.amount}
               onChange={(e) => setDone({ ...done, amount: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-28" placeholder="Receipt ref" value={done.receiptRef}
               onChange={(e) => setDone({ ...done, receiptRef: e.target.value })} />
        <button onClick={complete} disabled={!done.visitId}
                className="bg-blue-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50">Complete (geo-tagged)</button>
      </div>
      <Err msg={err} />
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

/* ---------------- NACH ---------------- */
function NachTab() {
  const [mandates, setMandates] = useState<any[]>([]);
  const [form, setForm] = useState({ loanId: "", umrn: "", bank: "", amountCap: "" });
  const [err, setErr] = useState("");
  const load = useCallback(() => { api("/api/nach").then((r) => setMandates(r.body.mandates || [])); }, []);
  useEffect(load, [load]);

  async function register() {
    setErr("");
    const res = await api("/api/nach", { action: "register", ...form, amountCap: Number(form.amountCap) });
    if (res.body.ok) { setForm({ loanId: "", umrn: "", bank: "", amountCap: "" }); load(); }
    else setErr(res.body.error || "failed");
  }
  async function present(m: any, outcome: "SUCCESS" | "BOUNCE") {
    setErr("");
    const res = await api("/api/nach", {
      action: "presentment", mandateId: m.id, outcome,
      amount: Math.min(m.emiAmount ?? m.amountCap, m.amountCap),
      reason: outcome === "BOUNCE" ? "01 insufficient funds" : undefined,
    });
    if (res.body.ok) load(); else setErr(res.body.error || "failed");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Mandate status per loan. A successful presentment closes through the same path as a
        payment webhook; a <b>bounce raises an orchestrator event</b> (3 bounces → EXHAUSTED).
      </p>
      <div className="flex flex-wrap gap-2 items-center rounded border bg-slate-50 p-2">
        <input className="border rounded px-2 py-1 text-sm w-32" placeholder="Loan ID" value={form.loanId}
               onChange={(e) => setForm({ ...form, loanId: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-40" placeholder="UMRN" value={form.umrn}
               onChange={(e) => setForm({ ...form, umrn: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-32" placeholder="Debtor bank" value={form.bank}
               onChange={(e) => setForm({ ...form, bank: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm w-28" placeholder="₹ cap" value={form.amountCap}
               onChange={(e) => setForm({ ...form, amountCap: e.target.value })} />
        <button onClick={register} disabled={!form.loanId || !form.umrn || !form.amountCap}
                className="bg-blue-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50">Register mandate</button>
      </div>
      <Err msg={err} />
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">
          <th>Loan</th><th>UMRN</th><th>Bank</th><th>Cap</th><th>Status</th><th>Bounces</th><th>Last</th><th></th>
        </tr></thead>
        <tbody>
          {mandates.map((m: any) => (
            <tr key={m.id} className="border-t">
              <td>{m.loanId}</td><td className="font-mono text-xs">{m.umrn}</td><td>{m.bank}</td>
              <td>₹{Number(m.amountCap).toLocaleString("en-IN")}</td>
              <td><span className={`px-2 py-0.5 rounded text-xs ${m.status === "ACTIVE" ? "bg-emerald-100" : m.status === "EXHAUSTED" ? "bg-red-100" : "bg-slate-100"}`}>{m.status}</span></td>
              <td>{m.bounceCount}</td>
              <td>{m.lastOutcome ? `${m.lastOutcome} ${m.lastPresentedAt ? new Date(m.lastPresentedAt).toLocaleDateString() : ""}` : "—"}</td>
              <td className="whitespace-nowrap">
                <button onClick={() => present(m, "SUCCESS")} className="text-xs text-emerald-700 underline mr-2">success</button>
                <button onClick={() => present(m, "BOUNCE")} className="text-xs text-red-700 underline">bounce</button>
              </td>
            </tr>
          ))}
          {mandates.length === 0 && <tr><td colSpan={8} className="py-3 text-slate-500">No mandates registered.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Ops ---------------- */
function OpsTab() {
  const [data, setData] = useState<{ unmatched: any[]; audit: any[]; gateDecisions: any[]; error?: string }>({ unmatched: [], audit: [], gateDecisions: [] });
  const [callbacks, setCallbacks] = useState<any[]>([]);
  useEffect(() => {
    api("/api/ops").then((r) => setData({ unmatched: [], audit: [], gateDecisions: [], ...r.body }));
    api("/api/callbacks").then((r) => setCallbacks(r.body.callbacks || []));
  }, []);
  if (data.error) return <Err msg={`${data.error} — switch role to compliance/admin`} />;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium text-sm mb-2">Scheduled callbacks (borrower asked to be called later)</h3>
        {callbacks.length === 0 && <p className="text-sm text-slate-500">None scheduled.</p>}
        <ul className="space-y-1 text-sm">
          {callbacks.filter((c) => c.status === "PENDING").map((c: any, i: number) => (
            <li key={i} className="flex gap-3">
              <span className="font-mono text-xs">{c.loanId}</span><span>{c.borrower}</span>
              <span className="text-slate-600">{new Date(c.scheduledFor).toLocaleString()}</span>
              <span className="text-slate-500 truncate">{c.reason}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium text-sm mb-2">Unmatched payments (human reconciliation queue)</h3>
        {data.unmatched.length === 0 && <p className="text-sm text-slate-500">Queue empty.</p>}
        <ul className="space-y-1 text-sm">
          {data.unmatched.map((u: any) => (
            <li key={u.id} className="flex gap-3"><span className="font-mono text-xs">{u.reference}</span>
              <span>₹{Number(u.amount).toLocaleString("en-IN")}</span><span className="text-slate-500">{u.utr || ""}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium text-sm mb-2">Audit trail (last 100 writes)</h3>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>
            {data.audit.map((a: any) => (
              <tr key={a.id} className="border-t">
                <td>{new Date(a.at).toLocaleString()}</td><td>{a.actor}</td><td>{a.role}</td>
                <td>{a.action}</td><td className="font-mono">{a.entity} {a.entityId?.slice(0, 14)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="font-medium text-sm mb-2">Recent gate decisions</h3>
        <ul className="space-y-1 text-xs">
          {data.gateDecisions.map((g: any) => (
            <li key={g.id} className="flex gap-2">
              <span className={`px-1.5 rounded ${g.gateVerdict === "ALLOW" ? "bg-emerald-100" : g.gateVerdict === "DEFER" ? "bg-amber-100" : "bg-red-100"}`}>{g.gateVerdict}</span>
              <span className="text-slate-600">{(g.details as any)?.channel} · {(g.details as any)?.blockedBy || "ok"} · {new Date(g.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
