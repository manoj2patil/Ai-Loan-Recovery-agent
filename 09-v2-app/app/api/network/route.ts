// GET /api/network — the guarantor network graph: nodes + edges + clustered layout for the
// SVG viz, plus book-level analytics (shared guarantors, guarantors-who-borrow, clustered
// defaults, exposure, indirect leverage paths). PII masked.

import { NextResponse } from "next/server";
import { buildNetwork, networkAnalytics } from "@/lib/network";

export async function GET() {
  const graph = buildNetwork();
  return NextResponse.json({
    graph: { nodes: graph.nodes, edges: graph.edges, layout: graph.layout },
    clusters: graph.clusters,
    analytics: networkAnalytics(),
  });
}
