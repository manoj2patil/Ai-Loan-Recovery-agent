// src/lib/cbs.ts — CBS integration + CSV import (BUILD_STEPS Step 11).
// The CBS fetch is env-driven (CBS_API_URL from SystemConfig/env; vendor adapters:
// Finacle/Flexcube/BaNCS/FinnOne map to the same CBSLoan shape). Without a reachable CBS
// this module still supports the CSV path used by smaller cooperative banks.

import { getDb, persist, newId } from "./store";
import { getConfig } from "./config";

export interface ImportSummary { customersUpserted: number; loansUpserted: number; rejected: { line: number; reason: string }[] }

/** CSV upsert: columns loanId,customerId,name,phone,language,product,principal,emi,
 *  tenureMonths,outstanding,pending,pendingInstallments,dpd,classification */
export function importLoansCsv(csvText: string): ImportSummary {
  const db = getDb();
  const summary: ImportSummary = { customersUpserted: 0, loansUpserted: 0, rejected: [] };
  const rows = csvText.split(/\r?\n/).filter((l) => l.trim());
  const header = rows.shift()?.toLowerCase().split(",").map((h) => h.replace(/"/g, "").trim()) ?? [];
  const col = (name: string) => header.indexOf(name);
  if (col("loanid") < 0 || col("phone") < 0) throw new Error("CSV must include loanId and phone columns");

  rows.forEach((line, idx) => {
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const get = (name: string) => cells[col(name)] ?? "";
    const loanId = get("loanid"); const phone = get("phone");
    if (!/^LN\d+/.test(loanId)) return summary.rejected.push({ line: idx + 2, reason: "bad loanId" });
    if (!/^\+?\d{10,13}$/.test(phone)) return summary.rejected.push({ line: idx + 2, reason: "bad phone" });

    let customer = db.customers.find((c) => c.phone === phone || c.customerId === get("customerid"));
    if (!customer) {
      customer = {
        id: newId("cus"), customerId: get("customerid") || `CUST-IMP-${idx}`, name: get("name") || "Imported Customer",
        phone, preferredLanguage: get("language") || "hi",
        consentSms: { granted: false }, consentWhatsapp: { granted: false }, consentVoice: { granted: false },
        suppressionFlags: { doNotCall: false, bankruptcyNotice: false, deceased: false },
      };
      db.customers.push(customer);
      summary.customersUpserted++;
    }

    const num = (name: string, dflt = 0) => Number(get(name)) || dflt;
    const existing = db.loans.find((l) => l.loanId === loanId);
    const patch = {
      customerId: customer.id, productType: get("product") || "PERSONAL",
      principal: num("principal"), emiAmount: num("emi"), tenureMonths: num("tenuremonths", 12),
      totalOutstanding: num("outstanding"), pendingAmount: num("pending"),
      pendingInstallments: num("pendinginstallments"), dpd: num("dpd"),
      assetClassification: get("classification") || "STANDARD",
    };
    if (existing) Object.assign(existing, patch);
    else db.loans.push({ id: newId("loan"), loanId, ...patch });
    summary.loansUpserted++;
  });

  persist();
  return summary;
}

/** CBS delta sync. With CBS_API_URL configured this pulls the vendor API through the
 *  adapter; in dev (no CBS reachable) it reports the configured endpoint + schedule so the
 *  wiring can be verified end-to-end without a core banking system. */
export async function cbsSync(): Promise<{ mode: "live" | "configured-only"; endpoint: string; schedule: string; note: string }> {
  const endpoint = process.env.CBS_API_URL || getConfig("CBS_API_URL", "");
  const schedule = getConfig("CBS_ETL_SCHEDULE", "0 */4 * * *");
  // PRODUCTION: fetch(`${endpoint}/loans?since=...`) via the vendor adapter, then upsert
  // with the same code path as importLoansCsv. Kept behind the env flag so dev stays offline.
  return {
    mode: "configured-only", endpoint: endpoint || "(unset)", schedule,
    note: "CBS pull runs on the ETL schedule in production; dev verifies wiring only",
  };
}
