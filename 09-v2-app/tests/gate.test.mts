// Unit tests for the Compliance Gate (BUILD_STEPS Step 3: "write unit tests for every veto
// reason"), plus auth primitives and encryption-at-rest round-trip. Runs against an
// isolated empty store (SAHAYAK_DATA_DIR tempdir, no CBS seed).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SAHAYAK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sahayak-test-"));
process.env.SAHAYAK_SEED_PATH = "/nonexistent-seed.json";
delete process.env.STORE_ENCRYPTION_KEY;

const { getDb, persist, encryptStore, decryptStore } = await import("../src/lib/store");
const { evaluateGate } = await import("../src/lib/compliance");
const { hashPassword, verifyPassword, createSessionToken, verifySessionToken } =
  await import("../src/lib/auth");
import crypto from "node:crypto";

let seq = 0;
function mkCustomer(overrides: Record<string, unknown> = {}) {
  const db = getDb();
  const c = {
    id: `test_c${++seq}`, customerId: `CUST-T${seq}`, name: `Test Person ${seq}`,
    phone: `+91900000${String(seq).padStart(4, "0")}`, preferredLanguage: "hi",
    consentSms: { granted: true }, consentWhatsapp: { granted: true }, consentVoice: { granted: true },
    suppressionFlags: { doNotCall: false, bankruptcyNotice: false, deceased: false },
    ...overrides,
  };
  db.customers.push(c as never);
  persist();
  return c;
}

function setHours(start: number, end: number) {
  const db = getDb();
  db.systemConfig = db.systemConfig.filter((r) => !r.key.startsWith("CALLING_HOURS"));
  db.systemConfig.push(
    { key: "CALLING_HOURS_START", value: String(start), category: "COMPLIANCE" },
    { key: "CALLING_HOURS_END", value: String(end), category: "COMPLIANCE" },
  );
  persist();
}
setHours(0, 24); // deterministic: within hours unless a test narrows them

test("BLOCK: deceased suppression flag", async () => {
  const c = mkCustomer({ suppressionFlags: { doNotCall: false, bankruptcyNotice: false, deceased: true } });
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "BLOCK"); assert.equal(r.blockedBy, "deceased");
});

test("BLOCK: bankruptcy notice", async () => {
  const c = mkCustomer({ suppressionFlags: { doNotCall: false, bankruptcyNotice: true, deceased: false } });
  const r = await evaluateGate({ customerId: c.id, channel: "whatsapp", intent: "recovery" });
  assert.equal(r.verdict, "BLOCK"); assert.equal(r.blockedBy, "bankruptcy_notice");
});

test("BLOCK: doNotCall flag vetoes voice only", async () => {
  const c = mkCustomer({ suppressionFlags: { doNotCall: true, bankruptcyNotice: false, deceased: false } });
  assert.equal((await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" })).blockedBy, "do_not_call_flag");
  assert.equal((await evaluateGate({ customerId: c.id, channel: "whatsapp", intent: "recovery" })).verdict, "ALLOW");
});

test("BLOCK: missing channel consent", async () => {
  const c = mkCustomer({ consentVoice: { granted: false } });
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "BLOCK"); assert.equal(r.blockedBy, "no_consent_voice");
});

test("BLOCK: DND registry when consent override is off", async () => {
  process.env.DND_CONSENT_OVERRIDE = "false";
  const c = mkCustomer();
  getDb().dncNumbers.push(c.phone); persist();
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "BLOCK"); assert.equal(r.blockedBy, "dnd_registry");
});

test("ALLOW: DND listed but recorded consent overrides (configurable)", async () => {
  process.env.DND_CONSENT_OVERRIDE = "true";
  const c = mkCustomer();
  getDb().dncNumbers.push(c.phone); persist();
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "ALLOW");
  assert.ok(r.reasons.some((x) => x.includes("overridden by recorded consent")));
  process.env.DND_CONSENT_OVERRIDE = "false";
});

test("DEFER: active suppression (recent payment) — but receipts pass", async () => {
  const c = mkCustomer();
  getDb().suppressions.push({
    id: "sup_t1", customerId: c.id, reason: "paid", active: true,
    createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  persist();
  const dun = await evaluateGate({ customerId: c.id, channel: "whatsapp", intent: "recovery" });
  assert.equal(dun.verdict, "DEFER"); assert.equal(dun.blockedBy, "suppressed:paid");
  const receipt = await evaluateGate({ customerId: c.id, channel: "whatsapp", intent: "receipt" });
  assert.equal(receipt.verdict, "ALLOW");
});

test("DEFER: per-day frequency cap from SystemConfig (2 calls/day)", async () => {
  const c = mkCustomer();
  const db = getDb();
  for (let i = 0; i < 2; i++) {
    db.interactionLogs.push({
      id: `il_t${i}_${c.id}`, customerId: c.id, channel: "VOICE", direction: "OUTBOUND",
      outcome: "CALL_INITIATED", createdAt: new Date().toISOString(),
    });
  }
  persist();
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "DEFER"); assert.equal(r.blockedBy, "frequency_cap_voice_1d");
});

test("DEFER: outside configured calling hours", async () => {
  setHours(0, 0); // no legal window → always outside
  const c = mkCustomer();
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "DEFER"); assert.equal(r.blockedBy, "outside_calling_hours_ist");
  setHours(0, 24);
});

test("ALLOW: clean borrower passes with a full reason trail", async () => {
  const c = mkCustomer();
  const r = await evaluateGate({ customerId: c.id, channel: "voice", intent: "recovery" });
  assert.equal(r.verdict, "ALLOW");
  assert.ok(r.reasons.length >= 5, `trail has ${r.reasons.length} entries`);
});

test("auth: scrypt hash verifies and rejects", () => {
  const h = hashPassword("S3cure!pass");
  assert.ok(verifyPassword("S3cure!pass", h));
  assert.ok(!verifyPassword("wrong", h));
});

test("auth: session token round-trips and tampering fails", () => {
  const token = createSessionToken({
    id: "u1", username: "officer1", name: "Officer", role: "officer",
    passwordHash: "", active: true, createdAt: new Date().toISOString(),
  });
  const actor = verifySessionToken(token);
  assert.equal(actor?.role, "officer");
  const [payload] = token.split(".");
  assert.equal(verifySessionToken(`${payload}.deadbeef`), null);
  const forged = Buffer.from(JSON.stringify({ u: "x", n: "X", r: "admin", exp: Date.now() + 9e6 })).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${token.split(".")[1]}`), null);
});

test("encryption at rest: AES-256-GCM round-trip, tamper detected", () => {
  const key = crypto.scryptSync("test-key", "sahayak-store-v1", 32);
  const blob = encryptStore('{"hello":"world"}', key);
  assert.equal(decryptStore(blob, key), '{"hello":"world"}');
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => decryptStore(blob, key));
});
