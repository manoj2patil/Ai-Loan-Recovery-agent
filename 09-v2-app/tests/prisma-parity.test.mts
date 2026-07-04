// Parity test: the PostgreSQL adapter must return the same shapes/values as the JSON
// store for the same CBS export. Skips cleanly when DATABASE_URL is not set (unit runs);
// CI runs it against a postgres service after prisma db push + seed.

import { test } from "node:test";
import assert from "node:assert/strict";

const HAS_DB = !!process.env.DATABASE_URL;

if (!HAS_DB) {
  test("prisma parity (skipped — DATABASE_URL not set)", { skip: true }, () => {});
} else {
  const pg = await import("../src/lib/data/prisma-db");
  // isolated JSON store seeded from the same export
  process.env.SAHAYAK_DATA_DIR = (await import("node:fs")).mkdtempSync(
    (await import("node:path")).join((await import("node:os")).tmpdir(), "sahayak-parity-"));
  const { getDb } = await import("../src/lib/store");

  test("loan counts match", async () => {
    assert.equal((await pg.listLoans()).length, getDb().loans.length);
  });

  test("loan + customer join matches for LN500001", async () => {
    const a = await pg.findLoanByLoanId("LN500001");
    const b = getDb().loans.find((l) => l.loanId === "LN500001")!;
    const bc = getDb().customers.find((c) => c.id === b.customerId)!;
    assert.ok(a);
    assert.equal(a.totalOutstanding, b.totalOutstanding);
    assert.equal(a.dpd, b.dpd);
    assert.equal(a.customer.customerId, bc.customerId);
    assert.deepEqual(a.customer.consentVoice, bc.consentVoice);
  });

  test("SystemConfig values match (gate thresholds come from the DB)", async () => {
    assert.equal(await pg.getConfig("CALLING_HOURS_START", "?"), "9");
    assert.equal(await pg.getConfig("MAX_CALLS_PER_DAY", "?"), "2");
    assert.equal(await pg.getConfig("GUARANTOR_DPD_THRESHOLD", "?"), "60");
  });

  test("guarantor edges match for a loan that has them", async () => {
    const withG = getDb().guarantors[0];
    const pgG = await pg.guarantorsForLoan(withG.linkedLoanId);
    const jsonG = getDb().guarantors.filter((g) => g.linkedLoanId === withG.linkedLoanId);
    assert.equal(pgG.length, jsonG.length);
    assert.equal(pgG[0].guarantorId, jsonG[0].guarantorId);
    assert.deepEqual(pgG[0].consentVoice, jsonG[0].consentVoice);
  });

  test("suppression write/read round-trip", async () => {
    const c = getDb().customers[0];
    await pg.insertSuppression({ customerId: c.id, reason: "parity-test", endsAt: new Date(Date.now() + 60000).toISOString() });
    const sups = await pg.activeSuppressions(c.id);
    assert.ok(sups.some((s) => s.reason === "parity-test"));
  });

  test("disconnects cleanly", async () => { await pg.disconnect(); });
}
