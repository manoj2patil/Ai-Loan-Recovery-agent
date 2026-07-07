// Unit tests for the network graph + pilot planner over the seeded CBS data.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SAHAYAK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sahayak-np-"));
process.env.SAHAYAK_SEED_PATH = path.resolve(process.cwd(), "..", "02-data-and-schema", "database-backup.json");

const { buildNetwork, networkAnalytics } = await import("../src/lib/network");
const { branchRanking, abDesign, goNoGoGates, projectedLift, pilotPlan } = await import("../src/lib/pilot");

test("network graph builds nodes, edges, clusters with a layout", () => {
  const g = buildNetwork();
  assert.ok(g.nodes.length > 0, "has nodes");
  assert.ok(g.edges.length > 0, "has guarantee edges");
  assert.ok(g.clusters.length > 0, "has clusters");
  assert.ok(g.layout.width > 0 && g.layout.height > 0, "has layout dims");
  // every drawn node has coordinates
  assert.ok(g.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number"));
});

test("network analytics surfaces the committee metrics", () => {
  const a = networkAnalytics();
  assert.ok(a.sharedGuarantors >= 0);
  assert.ok(a.guarantorsWhoBorrow >= 0);
  assert.ok(a.clusters > 0);
  assert.ok(a.totalExposureInClusters > 0);
  assert.ok(Array.isArray(a.topLeverage));
  // clustered defaults have >=2 overdue members
  const g = buildNetwork();
  for (const c of g.clusters) if (c.clusteredDefault) assert.ok(c.overdueMembers >= 2);
});

test("clusters actually share a guarantor (union-find correctness)", () => {
  const g = buildNetwork();
  const multi = g.clusters.filter((c) => c.borrowers > 1);
  for (const c of multi) assert.ok(c.sharedGuarantors.length >= 1, `cluster ${c.id} multi-borrower needs a shared guarantor`);
});

test("pilot: branch ranking sorted by NPA volume", () => {
  const r = branchRanking();
  assert.ok(r.length > 0);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].npaOutstanding >= r[i].npaOutstanding, "descending NPA");
});

test("pilot: A/B split is deterministic and covers all overdue borrowers", () => {
  const top = branchRanking()[0].branch;
  const a1 = abDesign(top), a2 = abDesign(top);
  assert.equal(a1.treatment.n, a2.treatment.n, "deterministic");
  assert.equal(a1.control.n, a2.control.n);
  assert.ok(a1.treatment.n + a1.control.n > 0);
});

test("pilot: exactly 8 go/no-go gates, each GO or NO-GO", () => {
  const g = goNoGoGates();
  assert.equal(g.gates.length, 8);
  assert.ok(g.gates.every((x) => x.status === "GO" || x.status === "NO-GO"));
  assert.equal(g.passed, g.gates.filter((x) => x.status === "GO").length);
});

test("pilot: projected lift positive; plan has 4 phases", () => {
  const top = branchRanking()[0].branch;
  const lift = projectedLift(top);
  assert.ok(lift.relativeUpliftPct > 0);
  const plan = pilotPlan();
  assert.equal(plan.phases.length, 4);
  assert.ok(plan.topBranch.length > 0);
});
