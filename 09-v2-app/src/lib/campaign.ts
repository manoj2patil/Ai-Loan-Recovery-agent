// src/lib/campaign.ts — campaign auto-dial (BUILD_STEPS Step 10): segment the overdue book,
// gate-check the whole segment up front, queue only compliant borrowers, dial sequentially.
// Each /next call re-runs the gate (conditions change) before dialing.

import { getDb, persist, newId } from "./store";
import { listLoans, findCustomerById } from "./db";
import { evaluateGate } from "./compliance";
import { placeCall } from "./voice";
import { bucketFor } from "./business-rules";

export async function startCampaign(opts: {
  name: string;
  filters: { bucket?: string; product?: string; language?: string };
  limit?: number;
}) {
  const db = getDb();
  let gatedOut = 0;
  const queue: string[] = [];

  const candidates = listLoans()
    .filter((l) => l.dpd > 0)
    .filter((l) => !opts.filters.bucket || bucketFor(l.dpd) === opts.filters.bucket)
    .filter((l) => !opts.filters.product || l.productType === opts.filters.product)
    .sort((a, b) => b.dpd - a.dpd)
    .slice(0, opts.limit ?? 100);

  for (const loan of candidates) {
    const customer = findCustomerById(loan.customerId);
    if (!customer) continue;
    if (opts.filters.language && customer.preferredLanguage !== opts.filters.language) continue;
    const gate = await evaluateGate({ customerId: customer.id, channel: "voice", intent: "recovery" });
    if (gate.verdict === "ALLOW") queue.push(loan.loanId);
    else gatedOut++;
  }

  const campaign = {
    id: newId("cmp"), name: opts.name, filters: opts.filters,
    queue, placed: [], gatedOut,
    status: (queue.length ? "ACTIVE" : "DONE") as "ACTIVE" | "DONE",
    createdAt: new Date().toISOString(),
  };
  db.campaigns.push(campaign);
  persist();
  return campaign;
}

/** Dial the next compliant borrower in the queue. Re-gates at dial time. */
export async function nextCall(campaignId: string) {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c) throw new Error("campaign not found");
  if (c.status === "DONE" || c.queue.length === 0) {
    c.status = "DONE"; persist();
    return { done: true as const };
  }
  const loanId = c.queue.shift()!;
  const res = await placeCall(loanId, { intentNote: `campaign ${c.name}` });
  if (res.placed) c.placed.push(loanId); else c.gatedOut++;
  if (c.queue.length === 0) c.status = "DONE";
  persist();
  return { done: c.status === "DONE", loanId, placed: res.placed, gate: res.gate.verdict, remaining: c.queue.length };
}

export function listCampaigns() {
  return getDb().campaigns.map((c) => ({
    id: c.id, name: c.name, filters: c.filters, status: c.status,
    queued: c.queue.length, placed: c.placed.length, gatedOut: c.gatedOut, createdAt: c.createdAt,
  }));
}
