"use client";
// components/NetworkPilotSections.tsx — the moat visuals (ROADMAP Phase 5):
// Network Graph (SVG borrower↔guarantor clusters + leverage) and Pilot Rollout planner.

import { useEffect, useState } from "react";

async function api(url: string) {
  const r = await fetch(url, { headers: { "x-role": "compliance", "x-actor": "console" } });
  return r.json();
}
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
const cr = (n: number) => "₹" + (Number(n || 0) / 1e7).toFixed(2) + " cr";

type Tab = "network" | "pilot";

export default function NetworkPilotSections() {
  const [tab, setTab] = useState<Tab>("network");
  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold mb-3">Network Graph · Pilot Rollout (moat)</h2>
      <div className="flex gap-2 mb-4">
        {(["network", "pilot"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm ${tab === t ? "bg-violet-600 text-white" : "bg-slate-100"}`}>
            {t === "network" ? "Network Graph" : "Pilot Rollout"}
          </button>
        ))}
      </div>
      {tab === "network" ? <NetworkTab /> : <PilotTab />}
    </section>
  );
}

/* ---------------- Network Graph ---------------- */
const CLUSTER_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

function NetworkTab() {
  const [d, setD] = useState<any>(null);
  const [hover, setHover] = useState<any>(null);
  useEffect(() => { api("/api/network").then(setD); }, []);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const { nodes, edges, layout } = d.graph;
  const a = d.analytics;
  const pos = new Map<string, any>(nodes.map((n: any) => [n.id, n]));
  const color = (c: number) => CLUSTER_COLORS[c % CLUSTER_COLORS.length];
  const defaultClusters = new Set(d.clusters.filter((c: any) => c.clusteredDefault).map((c: any) => c.id));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {[
          ["Shared guarantors", a.sharedGuarantors],
          ["Guarantors who borrow", a.guarantorsWhoBorrow],
          ["Clustered defaults", a.clusteredDefaults],
          ["Exposure at risk", cr(a.exposureAtRisk)],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded border bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <span>● borrower (size = exposure)</span>
        <span>◆ guarantor</span>
        <span className="text-red-600">red ring = overdue</span>
        <span className="text-amber-600">amber halo = clustered-default cluster</span>
        <span>{nodes.length} nodes · {edges.length} links · {d.clusters.length} clusters</span>
      </div>

      <div className="border rounded overflow-auto bg-slate-50" style={{ maxHeight: 460 }}>
        <svg width={layout.width} height={layout.height} className="block">
          {d.clusters.filter((c: any) => c.clusteredDefault).map((c: any) => {
            const ns = nodes.filter((n: any) => n.cluster === c.id && n.x != null);
            if (!ns.length) return null;
            const cx = ns.reduce((s: number, n: any) => s + n.x, 0) / ns.length;
            const cy = ns.reduce((s: number, n: any) => s + n.y, 0) / ns.length;
            return <circle key={"h" + c.id} cx={cx} cy={cy} r={108} fill="#f59e0b" opacity={0.08} />;
          })}
          {edges.map((e: any, i: number) => {
            const s = pos.get(e.source), t = pos.get(e.target);
            if (!s || !t || s.x == null || t.x == null) return null;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#cbd5e1" strokeWidth={1} />;
          })}
          {nodes.filter((n: any) => n.x != null).map((n: any) => {
            const c = color(n.cluster);
            if (n.kind === "guarantor") {
              const s = 6 + Math.min((n.loansBacked || 1) * 2, 8);
              return (
                <g key={n.id} onMouseEnter={() => setHover({ ...n, t: "guarantor" })} onMouseLeave={() => setHover(null)}>
                  <rect x={n.x - s / 2} y={n.y - s / 2} width={s} height={s} transform={`rotate(45 ${n.x} ${n.y})`}
                    fill={n.alsoBorrower ? "#7c3aed" : c} stroke="#334155" strokeWidth={n.loansBacked > 1 ? 1.5 : 0.5} />
                </g>
              );
            }
            const r = 4 + Math.min(Math.sqrt((n.outstanding || 0) / 1e5), 9);
            return (
              <circle key={n.id} cx={n.x} cy={n.y} r={r} fill={c} opacity={0.85}
                stroke={n.overdue ? "#dc2626" : "#fff"} strokeWidth={n.overdue ? 1.6 : 0.6}
                onMouseEnter={() => setHover({ ...n, t: "borrower" })} onMouseLeave={() => setHover(null)} />
            );
          })}
        </svg>
      </div>
      {hover && (
        <div className="text-xs text-slate-700 bg-slate-100 rounded px-3 py-1.5 inline-block">
          {hover.t === "guarantor"
            ? <>◆ Guarantor {hover.label} · backs {hover.loansBacked} loan(s){hover.alsoBorrower ? " · also a borrower" : ""} · cluster {hover.cluster}</>
            : <>● {hover.label} · {inr(hover.outstanding)} outstanding · {hover.dpd} DPD · cluster {hover.cluster}</>}
        </div>
      )}

      <div>
        <h4 className="font-medium text-sm mb-1">Indirect leverage — shared guarantors reaching multiple defaulted borrowers</h4>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th>Guarantor</th><th>Cluster</th><th>Defaulters reached</th><th>Cluster exposure</th></tr></thead>
          <tbody>
            {a.topLeverage.map((g: any, i: number) => (
              <tr key={i} className="border-t"><td>{g.name} ({g.guarantorId})</td><td>{g.cluster}</td><td>{g.reaches}</td><td>{inr(g.exposure)}</td></tr>
            ))}
            {a.topLeverage.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-500">No multi-defaulter shared guarantors.</td></tr>}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-1">
          One conversation with a shared guarantor can influence every overdue borrower in the cluster — the leverage the cloud leaders don't model.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Pilot Rollout ---------------- */
function PilotTab() {
  const [p, setP] = useState<any>(null);
  useEffect(() => { api("/api/pilot").then(setP); }, []);
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const ab = p.abDesign; const lift = p.projectedLift;
  return (
    <div className="space-y-5">
      <div>
        <h4 className="font-medium text-sm mb-1">Branch ranking by NPA volume (city = branch)</h4>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>Branch</th><th>Loans</th><th>Overdue</th><th>NPA outstanding</th></tr></thead>
          <tbody>
            {p.branchRanking.map((b: any, i: number) => (
              <tr key={b.branch} className={`border-t ${i === 0 ? "bg-violet-50" : ""}`}>
                <td className="font-medium">{b.branch}{i === 0 && <span className="ml-2 text-xs text-violet-700">← pilot branch</span>}</td>
                <td>{b.loans}</td><td>{b.overdue}</td><td>{inr(b.npaOutstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded border p-3">
          <h4 className="font-medium text-sm mb-2">A/B design — {p.topBranch} {ab.balanced ? <span className="text-emerald-600 text-xs">balanced</span> : <span className="text-amber-600 text-xs">small sample — widen branch</span>}</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th></th><th>Treatment (AI)</th><th>Control (BAU)</th></tr></thead>
            <tbody>
              {[["Borrowers", ab.treatment.n, ab.control.n], ["Avg DPD", ab.treatment.avgDpd, ab.control.avgDpd],
                ["Outstanding", inr(ab.treatment.outstanding), inr(ab.control.outstanding)], ["Avg propensity", ab.treatment.avgPropensity, ab.control.avgPropensity]].map((r) => (
                <tr key={String(r[0])} className="border-t"><td className="text-slate-500">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded border p-3 space-y-1 text-sm">
          <h4 className="font-medium mb-1">Projected lift</h4>
          <div>Baseline recovery: <b>{lift.baselineRatePct}%</b> / cycle (BAU)</div>
          <div>Relative uplift (AI): <b className="text-emerald-700">+{lift.relativeUpliftPct}%</b></div>
          <div>Incremental recovery: <b>{inr(lift.incrementalRecovery)}</b> ({lift.incrementalPct} pts)</div>
          <div className="text-xs text-slate-500">Transparent assumptions; validated against control in Phase 1.</div>
        </div>
      </div>

      <div>
        <h4 className="font-medium text-sm mb-1">Go / No-Go gates — {p.goNoGo.passed}/{p.goNoGo.total} {p.goNoGo.cleared ? <span className="text-emerald-600">ALL CLEAR</span> : <span className="text-red-600">blocked</span>}</h4>
        <ul className="space-y-1 text-sm">
          {p.goNoGo.gates.map((g: any, i: number) => (
            <li key={i} className="flex gap-2 items-center">
              <span className={`px-2 py-0.5 rounded text-xs ${g.status === "GO" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{g.status}</span>
              <span className="font-medium">{g.name}</span><span className="text-slate-500 text-xs">— {g.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-medium text-sm mb-1">4-phase rollout</h4>
        <ol className="space-y-2">
          {p.phases.map((ph: any) => (
            <li key={ph.phase} className="rounded border p-2 text-sm">
              <div className="font-medium">Phase {ph.phase}: {ph.name}</div>
              <div className="text-slate-600">{ph.scope}</div>
              <div className="text-xs text-slate-500">Exit gate: {ph.exit}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
