"use client";
// components/V1Sections.tsx — the v1 console: Portfolio · Borrower 360 · Orchestrator & Rules
// · Governance. Same tab pattern and dev-RBAC header convention as V2Sections.

import { useCallback, useEffect, useState } from "react";

async function api(url: string, body?: unknown, role = "officer") {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-role": role, "x-actor": "console" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");

type Tab = "portfolio" | "borrower" | "orchestrator" | "governance";
const TABS: [Tab, string][] = [
  ["portfolio", "Portfolio"], ["borrower", "Borrower 360"],
  ["orchestrator", "Orchestrator & Rules"], ["governance", "Governance"],
];

export default function V1Sections() {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [loanId, setLoanId] = useState("");
  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold mb-3">Recovery Operations (v1)</h2>
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm ${tab === t ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "portfolio" && <PortfolioTab onPick={(id) => { setLoanId(id); setTab("borrower"); }} />}
      {tab === "borrower" && <BorrowerTab loanId={loanId} setLoanId={setLoanId} />}
      {tab === "orchestrator" && <OrchestratorTab />}
      {tab === "governance" && <GovernanceTab />}
    </section>
  );
}

/* ---------------- Portfolio ---------------- */
function PortfolioTab({ onPick }: { onPick: (loanId: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [runMsg, setRunMsg] = useState("");
  const load = useCallback(() => { api("/api/portfolio").then((r) => setData(r.body)); }, []);
  useEffect(load, [load]);
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const s = data.stats;

  async function runNpa() {
    const res = await api("/api/portfolio", { action: "run-npa" }, "compliance");
    setRunMsg(res.body.ok ? `NPA run: ${res.body.run.loansProcessed} processed, ${res.body.run.reclassified} reclassified` : res.body.error);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Loans", s.loans], ["Overdue", s.overdueLoans],
          ["Outstanding", inr(s.totalOutstanding)], ["Gross NPA", s.grossNpaPct + "%"],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded border bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <h4 className="font-medium mb-1">DPD buckets</h4>
          {Object.entries(s.byBucket).map(([b, v]: any) => (
            <div key={b} className="flex gap-2"><span className="w-16 text-slate-500">{b}</span>
              <span>{v.count} loans · {inr(v.outstanding)}</span></div>
          ))}
        </div>
        <div>
          <h4 className="font-medium mb-1">Classification</h4>
          {Object.entries(s.byClass).map(([b, v]: any) => (
            <div key={b} className="flex gap-2"><span className="w-28 text-slate-500">{b}</span><span>{v.count}</span></div>
          ))}
        </div>
        <div>
          <h4 className="font-medium mb-1">Propensity (overdue)</h4>
          {Object.entries(data.segments).map(([k, v]: any) => (
            <div key={k} className="flex gap-2"><span className="w-20 text-slate-500">{k}</span><span>{v}</span></div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={runNpa} className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm">
          Run NPA engine
        </button>
        <span className="text-xs text-slate-500">{runMsg}</span>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">
          <th>Loan</th><th>Borrower</th><th>Product</th><th>DPD</th><th>Class</th><th>Outstanding</th>
        </tr></thead>
        <tbody>
          {data.loans.slice(0, 15).map((l: any) => (
            <tr key={l.loanId} className="border-t cursor-pointer hover:bg-slate-50" onClick={() => onPick(l.loanId)}>
              <td className="text-indigo-700 underline">{l.loanId}</td><td>{l.borrower}</td>
              <td>{l.product}</td><td>{l.dpd}</td>
              <td><span className="px-2 py-0.5 rounded bg-slate-100 text-xs">{l.classification}</span></td>
              <td>{inr(l.outstanding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">Top 15 by DPD shown · click a loan for the 360 view. PII masked.</p>
    </div>
  );
}

/* ---------------- Borrower 360 ---------------- */
function BorrowerTab({ loanId, setLoanId }: { loanId: string; setLoanId: (v: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback((id: string) => {
    if (!id) return;
    api(`/api/borrower?loanId=${encodeURIComponent(id)}`).then((r) => setData(r.status === 200 ? r.body : { error: r.body.error }));
  }, []);
  useEffect(() => { load(loanId); }, [loanId, load]);

  async function outreach(type: "whatsapp" | "voice") {
    setMsg("…");
    const res = await api("/api/outreach", { type, loanId });
    setMsg(res.body.ok ? `${type} sent/placed ✅` : `gated: ${res.body.gate?.blockedBy ?? res.body.error}`);
    load(loanId);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="border rounded px-2 py-1.5 text-sm" placeholder="Loan ID (e.g. LN500001)"
               value={loanId} onChange={(e) => setLoanId(e.target.value)} />
        <button onClick={() => load(loanId)} className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm">Load</button>
      </div>
      {data?.error && <p className="text-sm text-red-700">⚠ {data.error}</p>}
      {data && !data.error && (
        <>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div className="rounded border bg-slate-50 p-3 space-y-1">
              <h4 className="font-medium">{data.borrower.name} · {data.borrower.customerId}</h4>
              <div>{data.borrower.phone} · lang {data.borrower.language}</div>
              <div className="text-xs text-slate-500">
                consent: voice {data.borrower.consent.voice ? "✓" : "✗"} · wa {data.borrower.consent.whatsapp ? "✓" : "✗"}
              </div>
              <div className="pt-1 flex gap-2">
                <button onClick={() => outreach("whatsapp")} className="border rounded px-2 py-1 text-xs">Send reminder</button>
                <button onClick={() => outreach("voice")} className="border rounded px-2 py-1 text-xs">Place call</button>
              </div>
              <div className="text-xs text-slate-600">{msg}</div>
            </div>
            <div className="rounded border bg-slate-50 p-3 space-y-1">
              <h4 className="font-medium">{data.loan.loanId} · {data.loan.product}</h4>
              <div>EMI {inr(data.loan.emi)} · outstanding {inr(data.loan.outstanding)}</div>
              <div>{data.loan.dpd} DPD · {data.loan.classification}</div>
              <div className="text-xs text-slate-500">
                guarantors: {data.guarantors.map((g: any) => `${g.name} (${g.relationship}, ${g.escalationStatus})`).join(", ") || "none"}
              </div>
            </div>
            <div className="rounded border bg-slate-50 p-3 space-y-1">
              <h4 className="font-medium">Best contact</h4>
              <div>{data.intelligence.bestContact.channel} · {data.intelligence.bestContact.bestWindowIst} IST</div>
              <div className="text-xs text-slate-500">{data.intelligence.bestContact.evidence}</div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div className="rounded border p-3">
              <h4 className="font-medium mb-1">
                Propensity {data.intelligence.propensity.score} · {data.intelligence.propensity.segment}
              </h4>
              {data.intelligence.propensity.factors.map((f: any) => (
                <div key={f.name} className="flex items-center gap-2 py-0.5">
                  <span className="w-44 text-xs text-slate-500">{f.name} ({f.weight}%)</span>
                  <div className="flex-1 bg-slate-100 rounded h-2"><div className="bg-indigo-500 h-2 rounded" style={{ width: `${f.score}%` }} /></div>
                  <span className="w-8 text-right text-xs">{f.score}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500 mt-1">Explainable: hover evidence in API payload.</p>
            </div>
            <div className="rounded border p-3 space-y-1">
              <h4 className="font-medium">Settlement recommendation</h4>
              <div>{data.intelligence.settlement.waiverPct}% waiver → <b>{inr(data.intelligence.settlement.settlementAmount)}</b></div>
              <p className="text-xs text-slate-500">{data.intelligence.settlement.rationale}</p>
              <h4 className="font-medium pt-2">Recent interactions ({data.history.calls} calls · {data.history.messages} messages)</h4>
              <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                {data.history.recent.map((i: any, n: number) => (
                  <li key={n}>{new Date(i.at).toLocaleDateString()} · {i.channel} {i.direction} → {i.outcome}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Orchestrator & Rules ---------------- */
function OrchestratorTab() {
  const [data, setData] = useState<{ rules: any[]; handoffs: any[] }>({ rules: [], handoffs: [] });
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api("/api/orchestrator").then((r) => setData(r.body)); }, []);
  useEffect(load, [load]);

  async function runCycle() {
    setBusy(true);
    const res = await api("/api/orchestrator", { action: "run", limit: 25 });
    setRun(res.body); setBusy(false); load();
  }
  async function toggle(id: string, enabled: boolean) {
    await api("/api/orchestrator", { action: "toggle-rule", id, enabled }, "compliance");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={runCycle} disabled={busy}
          className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
          {busy ? "Running…" : "Run orchestration cycle (25 worst DPD)"}
        </button>
        {run?.summary && (
          <span className="text-sm text-slate-600">
            executed {run.summary.EXECUTED ?? 0} · gated {run.summary.GATED ?? 0} · skipped {run.summary.SKIPPED ?? 0}
          </span>
        )}
      </div>
      {run?.actions && (
        <div className="max-h-48 overflow-y-auto rounded border p-2">
          {run.actions.map((a: any, i: number) => (
            <div key={i} className="text-xs flex gap-2 py-0.5">
              <span className={`px-1.5 rounded ${a.result === "EXECUTED" ? "bg-emerald-100" : a.result === "GATED" ? "bg-amber-100" : "bg-slate-100"}`}>{a.result}</span>
              <span className="w-20">{a.loanId}</span><span className="w-24 text-slate-500">{a.rule} {a.action}</span>
              <span className="text-slate-600">{a.detail}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <h4 className="font-medium text-sm mb-1">Business rules (12 defaults — toggle needs compliance role)</h4>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th>ID</th><th>Rule</th><th>Bucket</th><th>Action</th><th>Trigger</th><th>RBI ref</th><th>On</th></tr></thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.id} className="border-t">
                <td>{r.id}</td><td>{r.name}</td><td>{r.bucket}</td><td>{r.action}</td>
                <td>{r.triggerDpd}+ DPD</td><td className="text-slate-500">{r.rbiRef}</td>
                <td><input type="checkbox" checked={r.enabled} onChange={(e) => toggle(r.id, e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h4 className="font-medium text-sm mb-1">Human handoff queue ({data.handoffs.length})</h4>
        <ul className="text-xs space-y-0.5">
          {data.handoffs.slice(-10).map((h) => (
            <li key={h.id}>{h.loanId} — {h.reason} · {new Date(h.createdAt).toLocaleString()}</li>
          ))}
          {data.handoffs.length === 0 && <li className="text-slate-500">Empty.</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Governance ---------------- */
function GovernanceTab() {
  const [d, setD] = useState<any>(null);
  const [qa, setQa] = useState<any>(null);
  const [net, setNet] = useState<any>(null);
  useEffect(() => {
    api("/api/governance").then((r) => setD(r.body));
    api("/api/qa", undefined, "compliance").then((r) => setQa(r.body));
    api("/api/network").then((r) => setNet(r.body));
  }, []);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Recovered", inr(d.recovery.amount) + ` (${d.recovery.payments})`],
          ["PTP kept", d.ptp.keptRate == null ? "—" : d.ptp.keptRate + "%"],
          ["Active suppressions", d.activeSuppressions],
          ["Handoff queue", d.handoffQueue],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded border bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-8">
        <div>
          <h4 className="font-medium mb-1">Gate decisions (30d)</h4>
          {Object.entries(d.gateDecisions30d).map(([k, v]: any) => (
            <div key={k} className="flex gap-2"><span className="w-20 text-slate-500">{k}</span><span>{v}</span></div>
          ))}
          {Object.keys(d.gateDecisions30d).length === 0 && <p className="text-slate-500 text-xs">No decisions yet.</p>}
        </div>
        <div>
          <h4 className="font-medium mb-1">Channel economics (30d)</h4>
          {Object.entries(d.economics?.byChannel ?? {}).map(([k, v]: any) => (
            <div key={k} className="flex gap-2">
              <span className="w-24 text-slate-500">{k}</span>
              <span>{v.touches} touches · {inr(v.cost)}</span>
            </div>
          ))}
          <div className="text-xs text-slate-500 mt-1">
            total {inr(d.economics?.totalCost ?? 0)}
            {d.economics?.costPerRupeeRecovered != null && <> · {d.economics.costPerRupeeRecovered} ₹cost/₹recovered</>}
          </div>
        </div>
        {qa && !qa.error && (
          <div>
            <h4 className="font-medium mb-1">Call QA ({qa.callsScored} scored)</h4>
            <div>avg score <b>{qa.avgScore}</b> · hallucination-flagged <b>{qa.hallucinationFlagged}</b></div>
            {qa.checkFailRates?.map((c: any) => (
              <div key={c.check} className="flex gap-2 text-xs">
                <span className="w-40 text-slate-500">{c.check}</span><span>{c.failPct}% fail</span>
              </div>
            ))}
          </div>
        )}
        {net && (
          <div>
            <h4 className="font-medium mb-1">Guarantor network</h4>
            <div>{net.nodes.guarantors} guarantors · {net.edges.length} edges</div>
            <div className="text-xs text-slate-500">
              {net.insights.multiLoanGuarantors.length} back multiple loans ·{" "}
              {net.insights.crossExposedGuarantors.length} are themselves overdue borrowers
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-3 text-xs">
        <a className="text-indigo-700 underline" href="/api/data/export?entity=loans">Export loans (masked CSV)</a>
        <a className="text-indigo-700 underline" href="/api/data/export?entity=interactions">Export interactions (CSV)</a>
      </div>
      <p className="text-xs text-slate-500">
        Compliance-by-architecture: every outreach above passed the gate; every veto is on the trail in Ops.
      </p>
    </div>
  );
}
