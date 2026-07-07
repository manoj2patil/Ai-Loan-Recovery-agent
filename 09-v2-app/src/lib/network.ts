// src/lib/network.ts — the guarantor network graph (the moat feature). Computes borrower↔
// guarantor edges, shared-guarantor CLUSTERS (union-find), guarantors who are themselves
// borrowers, clustered defaults, total exposure per cluster, and indirect leverage paths
// (borrower → shared guarantor → other borrowers). Everything ledger-derived; PII masked.

import { getDb } from "./store";
import { maskName } from "./audit";

export interface GraphNode {
  id: string; kind: "borrower" | "guarantor"; label: string;
  cluster: number; dpd?: number; outstanding?: number; overdue?: boolean;
  loansBacked?: number; alsoBorrower?: boolean; x?: number; y?: number;
}
export interface GraphEdge { source: string; target: string; relationship: string }

export interface Cluster {
  id: number; borrowers: number; guarantors: number;
  members: { loanId: string; borrower: string; dpd: number; outstanding: number }[];
  sharedGuarantors: { guarantorId: string; name: string; loansBacked: number }[];
  totalExposure: number; overdueMembers: number; clusteredDefault: boolean;
}

// Union-find over borrower loans linked by a shared guarantor (same phone).
class DSU {
  p: Record<string, string> = {};
  find(x: string): string { return this.p[x] === undefined ? (this.p[x] = x) : this.p[x] === x ? x : (this.p[x] = this.find(this.p[x])); }
  union(a: string, b: string) { this.p[this.find(a)] = this.find(b); }
}

export function buildNetwork() {
  const db = getDb();
  const loanByDbId = new Map(db.loans.map((l) => [l.id, l]));
  const custById = new Map(db.customers.map((c) => [c.id, c]));

  // Guarantors grouped by phone (a person may back several loans under one number).
  const byPhone = new Map<string, typeof db.guarantors>();
  for (const g of db.guarantors) {
    const arr = byPhone.get(g.phone) ?? [];
    arr.push(g); byPhone.set(g.phone, arr);
  }

  // Union borrower-loans that share a guarantor phone → clusters.
  const dsu = new DSU();
  for (const l of db.loans) dsu.find("L:" + l.id);
  for (const [, gs] of byPhone) {
    const loans = gs.map((g) => g.linkedLoanId).filter((id) => loanByDbId.has(id));
    for (let i = 1; i < loans.length; i++) dsu.union("L:" + loans[0], "L:" + loans[i]);
  }

  // Assign cluster indices only to loans that are actually in a multi-member component OR
  // have at least one guarantor (isolated no-guarantor loans get cluster -1, not drawn).
  const compMembers = new Map<string, string[]>();
  for (const l of db.loans) {
    const root = dsu.find("L:" + l.id);
    (compMembers.get(root) ?? compMembers.set(root, []).get(root)!).push(l.id);
  }
  const guarantorLoanIds = new Set(db.guarantors.map((g) => g.linkedLoanId));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const clusters: Cluster[] = [];
  let clusterIdx = 0;
  const loanCluster = new Map<string, number>();

  for (const [, loanIds] of compMembers) {
    const withG = loanIds.filter((id) => guarantorLoanIds.has(id));
    // Draw clusters that have guarantors (single or shared); skip lone no-guarantor loans.
    if (withG.length === 0) continue;
    const cid = clusterIdx++;
    const members: Cluster["members"] = [];
    let exposure = 0, overdue = 0;
    const gSeen = new Map<string, { guarantorId: string; name: string; loansBacked: number }>();

    for (const lid of loanIds) {
      const loan = loanByDbId.get(lid)!;
      const cust = custById.get(loan.customerId);
      loanCluster.set(lid, cid);
      const isOverdue = loan.dpd > 0;
      members.push({ loanId: loan.loanId, borrower: cust ? maskName(cust.name) : "—", dpd: loan.dpd, outstanding: loan.totalOutstanding });
      exposure += loan.totalOutstanding;
      if (isOverdue) overdue++;
      nodes.push({
        id: "L:" + lid, kind: "borrower", label: cust ? maskName(cust.name) : loan.loanId,
        cluster: cid, dpd: loan.dpd, outstanding: loan.totalOutstanding, overdue: isOverdue,
        alsoBorrower: false,
      });
    }
    // Guarantor nodes + edges for this cluster.
    const clusterGuarantors = db.guarantors.filter((g) => loanIds.includes(g.linkedLoanId));
    for (const g of clusterGuarantors) {
      const gid = "G:" + g.phone;
      const backed = byPhone.get(g.phone)!.filter((x) => loanByDbId.has(x.linkedLoanId)).length;
      if (!gSeen.has(gid)) {
        gSeen.set(gid, { guarantorId: g.guarantorId, name: maskName(g.name), loansBacked: backed });
        // A guarantor who is themselves a borrower with their own loans (leverage point).
        const alsoBorrower = !!g.customerId && db.loans.some((l) => l.customerId === g.customerId);
        if (!nodes.find((n) => n.id === gid))
          nodes.push({ id: gid, kind: "guarantor", label: maskName(g.name), cluster: cid, loansBacked: backed, alsoBorrower });
      }
      edges.push({ source: gid, target: "L:" + g.linkedLoanId, relationship: g.relationship });
    }

    clusters.push({
      id: cid, borrowers: loanIds.length, guarantors: gSeen.size, members,
      sharedGuarantors: [...gSeen.values()].filter((g) => g.loansBacked > 1),
      totalExposure: exposure, overdueMembers: overdue, clusteredDefault: overdue >= 2,
    });
  }

  // Deterministic layout: clusters in a grid; within a cluster, guarantors near centre,
  // borrowers on a ring around them (so shared-guarantor hubs read visually).
  const perRow = Math.ceil(Math.sqrt(clusters.length || 1));
  const cellW = 260, cellH = 240;
  for (const c of clusters) {
    const cx = (c.id % perRow) * cellW + cellW / 2;
    const cy = Math.floor(c.id / perRow) * cellH + cellH / 2;
    const cNodes = nodes.filter((n) => n.cluster === c.id);
    const gs = cNodes.filter((n) => n.kind === "guarantor");
    const bs = cNodes.filter((n) => n.kind === "borrower");
    gs.forEach((n, i) => { const a = (i / Math.max(gs.length, 1)) * Math.PI * 2; n.x = cx + Math.cos(a) * 22; n.y = cy + Math.sin(a) * 22; });
    bs.forEach((n, i) => { const a = (i / Math.max(bs.length, 1)) * Math.PI * 2; n.x = cx + Math.cos(a) * 78; n.y = cy + Math.sin(a) * 78; });
  }

  const width = perRow * cellW;
  const height = Math.ceil((clusters.length || 1) / perRow) * cellH;
  return { nodes, edges, clusters, layout: { width, height } };
}

/** Book-level network analytics (the numbers a committee asks for). */
export function networkAnalytics() {
  const db = getDb();
  const { clusters } = buildNetwork();

  const byPhone = new Map<string, number>();
  for (const g of db.guarantors) byPhone.set(g.phone, (byPhone.get(g.phone) ?? 0) + 1);
  const sharedGuarantors = [...byPhone.values()].filter((n) => n > 1).length;

  const guarantorsWhoBorrow = db.guarantors.filter((g) =>
    g.customerId && db.loans.some((l) => l.customerId === g.customerId)).length;

  const clusteredDefaultClusters = clusters.filter((c) => c.clusteredDefault);
  const exposureInClusters = clusters.reduce((s, c) => s + c.totalExposure, 0);
  const exposureAtRisk = clusteredDefaultClusters.reduce((s, c) => s + c.totalExposure, 0);

  // Indirect leverage: shared guarantors ranked by how many DEFAULTED borrowers they can reach.
  const leverage = clusters
    .flatMap((c) => c.sharedGuarantors.map((g) => ({
      guarantorId: g.guarantorId, name: g.name, cluster: c.id,
      reaches: c.overdueMembers, exposure: c.totalExposure,
    })))
    .filter((x) => x.reaches >= 2)
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 10);

  return {
    borrowers: db.customers.length, guarantors: db.guarantors.length,
    sharedGuarantors, guarantorsWhoBorrow,
    clusters: clusters.length,
    clusteredDefaults: clusteredDefaultClusters.length,
    totalExposureInClusters: exposureInClusters,
    exposureAtRisk,
    topLeverage: leverage,
    biggestClusters: clusters.slice().sort((a, b) => b.totalExposure - a.totalExposure).slice(0, 5)
      .map((c) => ({ id: c.id, borrowers: c.borrowers, exposure: c.totalExposure, overdue: c.overdueMembers, clusteredDefault: c.clusteredDefault })),
  };
}
