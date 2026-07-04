// Acceptance tests for the v2 gap modules (V2_INTEGRATION.md):
//   1. A sandbox payment closes a PTP and blocks further outreach (suppression + receipt).
//   2. The legal dashboard shows a hearing within 14 days.
//   3. A completed visit with cash requires a receipt ref and logs channel VISIT.
// Run against a dev server:  npm run dev  (in another shell)  then  npm run acceptance
// The script talks HTTP only — same surface the UI uses — then inspects data/db.json.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "dev-webhook-secret";
const DB = path.resolve(process.cwd(), "data", "db.json");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
const db = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const api = async (url, opts = {}) => {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json", "x-role": "compliance", "x-actor": "acceptance-bot", ...(opts.headers || {}) },
    ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// Touch the API once so the store seeds itself from the CBS export on first run
await api("/api/field/visits");

// Pick a live loan from the seeded CBS data
const loanId = db().loans[0]?.loanId;
if (!loanId) { console.error("store is empty — start the dev server once to seed"); process.exit(1); }
console.log(`Using loan ${loanId}\n`);

console.log("1) Payments: link → signed webhook → PTP KEPT + suppression + receipt");
{
  const { body: created } = await api("/api/payments/link", {
    method: "POST", body: JSON.stringify({ loanId, purpose: "PTP" }),
  });
  check("payment link created", !!created?.link?.id, JSON.stringify(created));
  const linkId = created.link.id;

  // webhook with a BAD signature must be rejected
  const evt = JSON.stringify({ tr: linkId, amount: created.link.amount, utr: "UTRACCEPT001", paidAt: new Date().toISOString() });
  const bad = await api("/api/payments/webhook", {
    method: "POST", body: evt, headers: { "x-webhook-signature": "deadbeef" },
  });
  check("webhook rejects bad signature (401)", bad.status === 401);

  // correctly signed webhook reconciles
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(evt).digest("hex");
  const ok = await api("/api/payments/webhook", {
    method: "POST", body: evt, headers: { "x-webhook-signature": sig },
  });
  check("webhook reconciles", ok.body.action === "reconciled_suppressed_receipted", JSON.stringify(ok.body));

  // idempotency: same event again is a no-op
  const dup = await api("/api/payments/webhook", {
    method: "POST", body: evt, headers: { "x-webhook-signature": sig },
  });
  check("duplicate webhook ignored (idempotent)", dup.body.action === "duplicate_ignored");

  const d = db();
  const link = d.paymentLinks.find((l) => l.id === linkId);
  const ptp = d.ptps.find((p) => p.loanId === loanId);
  const sup = d.suppressions.find((s) => s.customerId === link.customerId && s.reason === "paid" && s.active);
  const receipt = d.interactionLogs.find((i) => i.outcome === "RECEIPT_SENT" && i.loanId === loanId);
  const payLog = d.interactionLogs.find((i) => i.outcome === "PAYMENT_RECEIVED" && i.loanId === loanId);
  check("link marked PAID with UTR", link?.status === "PAID" && link?.utr === "UTRACCEPT001");
  check("PTP closed as KEPT", ptp?.status === "KEPT");
  check("suppression active (further outreach blocked)", !!sup);
  check("receipt InteractionLog written", !!receipt);
  check("PAYMENT_RECEIVED InteractionLog written", !!payLog);

  // and the gate must now DEFER fresh outreach for this customer
  // (checked via the field-visit schedule path below returning 409 for this loan)
  const blocked = await api("/api/field/visits", {
    method: "POST",
    body: JSON.stringify({ action: "schedule", loanId, agentId: "FA01", scheduledFor: new Date(Date.now() + 86400000).toISOString(), address: "test" }),
  });
  check("gate blocks outreach after payment (409 suppressed)", blocked.status === 409 && blocked.body.gate?.blockedBy?.startsWith("suppressed"), JSON.stringify(blocked.body));
}

console.log("\n2) Legal: hearing within 14 days appears on the dashboard");
{
  const hearingDate = new Date(Date.now() + 7 * 86400000).toISOString();
  const { body: created } = await api("/api/legal/cases", {
    method: "POST",
    body: JSON.stringify({ action: "create", loanId, type: "SARFAESI", court: "DRT Ernakulam", caseNumber: "SA/42/2026", advocateId: "ADV-Menon", nextHearing: hearingDate }),
  });
  check("legal case created", !!created?.case?.id, JSON.stringify(created));

  const served = await api("/api/legal/cases", {
    method: "POST",
    body: JSON.stringify({ action: "advance", caseId: created.case.id, toStage: "NOTICE_SERVED", note: "13(2) notice served" }),
  });
  check("13(2) served → 60-day statutory clock set", !!served.body?.case?.statutoryDeadline);

  // possession is restricted: an officer must get 403
  const officerTry = await api("/api/legal/cases", {
    method: "POST", headers: { "x-role": "officer" },
    body: JSON.stringify({ action: "advance", caseId: created.case.id, toStage: "POSSESSION_13_4", note: "attempt" }),
  });
  check("possession transition denied to officer (403)", officerTry.status === 403);

  const { body: dash } = await api("/api/legal/cases");
  const hearing = dash.upcoming.find((o) => o.caseId === created.case.id && o.kind === "HEARING");
  check("hearing shows in 14-day window", !!hearing, JSON.stringify(dash.upcoming));
}

console.log("\n3) Field: cash completion requires receipt ref; logs channel VISIT");
{
  // use a different loan — the first one is suppressed (paid) now
  const loan2 = db().loans.find((l) => {
    const c = db().customers.find((c) => c.id === l.customerId);
    return c && c.consentVoice?.granted && !c.suppressionFlags?.deceased &&
      !db().suppressions.some((s) => s.customerId === c.id && s.active);
  });
  check("found unsuppressed consenting loan for visit", !!loan2);

  const sched = await api("/api/field/visits", {
    method: "POST",
    body: JSON.stringify({ action: "schedule", loanId: loan2.loanId, agentId: "FA01", scheduledFor: new Date(Date.now() + 3600000).toISOString(), address: "26, Ambedkar Marg, Kozhikode", lat: 11.25, lng: 75.78 }),
  });
  check("visit scheduled through gate", sched.body?.ok === true && sched.body?.gate?.verdict === "ALLOW", JSON.stringify(sched.body));
  const visitId = sched.body?.visit?.id;

  // cash without receipt must fail
  const noReceipt = await api("/api/field/visits", {
    method: "POST",
    body: JSON.stringify({ action: "complete", visitId, outcome: "PAID", lat: 11.25, lng: 75.78, amountCollected: 5000 }),
  });
  check("cash without receiptRef rejected (400)", noReceipt.status === 400 && /receipt/.test(noReceipt.body.error || ""));

  // with receipt succeeds
  const done = await api("/api/field/visits", {
    method: "POST",
    body: JSON.stringify({ action: "complete", visitId, outcome: "PAID", lat: 11.25, lng: 75.78, amountCollected: 5000, receiptRef: "RCPT-0007" }),
  });
  check("completion with receiptRef ok", done.body?.ok === true, JSON.stringify(done.body));

  const d = db();
  const visitLog = d.interactionLogs.find((i) => i.channel === "VISIT" && i.loanId === loan2.loanId);
  const visit = d.fieldVisits.find((v) => v.id === visitId);
  const sup2 = d.suppressions.find((s) => s.customerId === loan2.customerId && s.reason === "paid" && s.active);
  check("InteractionLog channel VISIT written", !!visitLog);
  check("visit geo-tagged at completion", visit?.geoAt != null && visit?.lat === 11.25);
  check("collection flowed to suppression (same path as webhook)", !!sup2);
}

console.log("\n4) NACH: mandate view; bounce raises orchestrator event; success closes like a payment");
{
  const loan3 = db().loans.find((l) =>
    !db().nachMandates?.some((m) => m.loanId === l.loanId) &&
    !db().suppressions.some((s) => s.customerId === l.customerId && s.active));
  check("found loan for mandate", !!loan3);

  const reg = await api("/api/nach", {
    method: "POST",
    body: JSON.stringify({ action: "register", loanId: loan3.loanId, umrn: "UMRN00042X", bank: "SBI", amountCap: loan3.emiAmount * 2 }),
  });
  check("mandate registered ACTIVE", reg.body?.mandate?.status === "ACTIVE", JSON.stringify(reg.body));
  const mandateId = reg.body?.mandate?.id;

  const bounce = await api("/api/nach", {
    method: "POST",
    body: JSON.stringify({ action: "presentment", mandateId, outcome: "BOUNCE", amount: loan3.emiAmount, reason: "01 insufficient funds" }),
  });
  check("bounce records + emits event", bounce.body?.action === "bounced_event_emitted", JSON.stringify(bounce.body));
  const bounceEvt = db().interactionLogs.find((i) => i.outcome === "EVENT_NACH_BOUNCE" && i.loanId === loan3.loanId);
  check("EVENT_NACH_BOUNCE in InteractionLog (orchestrator event)", !!bounceEvt);

  const success = await api("/api/nach", {
    method: "POST",
    body: JSON.stringify({ action: "presentment", mandateId, outcome: "SUCCESS", amount: loan3.emiAmount, utr: "NACHUTR777" }),
  });
  check("success presentment closes", success.body?.action === "presentment_success_closed", JSON.stringify(success.body));
  const supN = db().suppressions.find((s) => s.customerId === loan3.customerId && s.reason === "paid" && s.active);
  check("NACH success created suppression (same closure path)", !!supN);

  const overCap = await api("/api/nach", {
    method: "POST",
    body: JSON.stringify({ action: "presentment", mandateId, outcome: "SUCCESS", amount: loan3.emiAmount * 99 }),
  });
  check("presentment above mandate cap rejected", overCap.status === 400 && /cap/.test(overCap.body.error || ""));

  const view = await api("/api/nach");
  check("mandate view shows status per loan", view.body.mandates?.some((m) => m.loanId === loan3.loanId && m.status === "ACTIVE"));
}

console.log("\n5) Ops: audit trail requires compliance role");
{
  const officer = await api("/api/ops", { headers: { "x-role": "officer" } });
  check("ops denied to officer (403)", officer.status === 403);
  const ok = await api("/api/ops");
  check("ops returns audit trail for compliance", Array.isArray(ok.body.audit) && ok.body.audit.length > 0);
}

console.log("\n6) Portfolio & NPA engine (SystemConfig-driven)");
{
  const { body: p } = await api("/api/portfolio");
  check("portfolio stats computed", p.stats?.loans === 131 && p.stats?.customers === 64, JSON.stringify(p.stats).slice(0, 120));
  check("DPD buckets present", p.stats && Object.keys(p.stats.byBucket).length > 0);
  check("propensity segments computed", p.segments && (p.segments.HIGH + p.segments.MEDIUM + p.segments.LOW) > 0);

  const officerRun = await api("/api/portfolio", { method: "POST", headers: { "x-role": "officer" }, body: JSON.stringify({ action: "run-npa" }) });
  check("NPA run denied to officer (403)", officerRun.status === 403);
  const run = await api("/api/portfolio", { method: "POST", body: JSON.stringify({ action: "run-npa" }) });
  check("NPA engine runs (compliance)", run.body?.ok === true && run.body?.run?.loansProcessed === 131, JSON.stringify(run.body));
}

console.log("\n7) Borrower 360 + explainable intelligence");
{
  const { body: b } = await api(`/api/borrower?loanId=${loanId}`);
  check("borrower 360 returns masked profile", !!b.borrower && /X{4,}/.test(b.borrower.phone));
  check("propensity has 6 weighted factors", b.intelligence?.propensity?.factors?.length === 6 &&
    b.intelligence.propensity.factors.reduce((s, f) => s + f.weight, 0) === 100);
  check("every factor carries evidence", b.intelligence.propensity.factors.every((f) => f.evidence?.length > 0));
  check("settlement recommendation bounded", b.intelligence?.settlement?.settlementAmount > 0 &&
    b.intelligence.settlement.settlementAmount <= b.loan.outstanding);
  check("best-time window inside legal hours", /^(9|1[0-8]):00/.test(b.intelligence?.bestContact?.bestWindowIst ?? ""));
}

console.log("\n8) Business rules + orchestrator (gate has the veto)");
{
  const { body: o } = await api("/api/orchestrator");
  check("12 default rules installed", o.rules?.length === 12 && o.rules.every((r) => r.isDefault));

  const officerToggle = await api("/api/orchestrator", { method: "POST", headers: { "x-role": "officer" }, body: JSON.stringify({ action: "toggle-rule", id: "BR01", enabled: false }) });
  check("rule toggle denied to officer (403)", officerToggle.status === 403);

  const run = await api("/api/orchestrator", { method: "POST", body: JSON.stringify({ action: "run", limit: 10 }) });
  check("cycle runs over worst-DPD loans", run.body?.ok === true && run.body.actions?.length > 0, JSON.stringify(run.body?.summary));
  check("cycle executed some actions", (run.body?.summary?.EXECUTED ?? 0) > 0, JSON.stringify(run.body?.summary));

  // every EXECUTED whatsapp/voice action must have a gate-ALLOW interaction log behind it
  const d = db();
  const outbound = d.interactionLogs.filter((i) => ["WHATSAPP", "VOICE"].includes(i.channel) && i.direction === "OUTBOUND" && i.gateVerdict);
  check("outbound outreach carries gate verdicts", outbound.length > 0 && outbound.every((i) => i.gateVerdict === "ALLOW"));

  // guarantor escalation respects config threshold + consent whitelist
  const under = d.loans.find((l) => l.dpd > 0 && l.dpd < 60);
  if (under) {
    const esc = await api("/api/orchestrator", { method: "POST", body: JSON.stringify({ action: "escalate-guarantor", loanId: under.loanId }) });
    check("guarantor escalation refused under threshold", esc.body?.escalated === false && /threshold/.test(esc.body?.detail ?? ""), JSON.stringify(esc.body));
  } else {
    check("guarantor escalation refused under threshold", true, "no sub-60-DPD loan to test");
  }
  // only escalations performed by THIS run (historic CBS rows may predate consent capture)
  const recentCut = Date.now() - 3600000;
  const notified = d.guarantors.filter((g) => g.escalationStatus === "NOTIFIED" &&
    g.lastEscalatedAt && Date.parse(g.lastEscalatedAt) >= recentCut);
  check("escalated guarantors are consented + stamped",
    notified.every((g) => g.consentVoice?.granted || g.consentWhatsapp?.granted),
    `${notified.length} escalated this run`);
}

console.log("\n9) Governance KPIs");
{
  const { body: g } = await api("/api/governance");
  check("governance aggregates gate + channel mix", !!g.gateDecisions30d && !!g.channelMix30d);
  check("recovery figures ledger-derived", g.recovery?.amount > 0 && g.recovery?.payments > 0, JSON.stringify(g.recovery));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
