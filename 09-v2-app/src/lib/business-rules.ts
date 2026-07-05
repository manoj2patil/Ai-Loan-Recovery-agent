// src/lib/business-rules.ts — the 12 default RBI rules across 5 DPD buckets and 6 action
// types (BUILD_STEPS Step 8). Default rules are protected: they can be toggled but not
// deleted. The orchestrator asks rulesDueForLoan() what to do; the Compliance Gate still
// has the veto on every resulting action.

import { listBusinessRules, saveBusinessRules, updateBusinessRule } from "./db";
import { cfg } from "./config";
import { BusinessRule } from "./store";

export type DpdBucket = BusinessRule["bucket"];

export function bucketFor(dpd: number): DpdBucket {
  if (dpd <= 30) return "0-30";
  if (dpd <= 60) return "31-60";
  if (dpd <= 90) return "61-90";
  if (dpd <= 180) return "91-180";
  return "180+";
}

/** The 12 defaults (RBI Fair Practices Code + SARFAESI/NI Act references). Thresholds that
 *  exist in SystemConfig are read from it at seed time — never hardcoded elsewhere. */
export function defaultRules(): BusinessRule[] {
  const g = cfg.guarantorDpdThreshold();   // 60
  const npa = cfg.npaDpdThreshold();       // 90
  const mk = (r: Omit<BusinessRule, "enabled" | "isDefault">): BusinessRule =>
    ({ ...r, enabled: true, isDefault: true });
  return [
    mk({ id: "BR01", name: "Gentle EMI reminder", bucket: "0-30", action: "WHATSAPP",
         triggerDpd: 1, template: "emi_due_reminder", rbiRef: "RBI FPC 2015 §2 (courteous reminder)" }),
    mk({ id: "BR02", name: "Courtesy call", bucket: "0-30", action: "VOICE",
         triggerDpd: 7, rbiRef: "RBI FPC — contact within civil hours" }),
    mk({ id: "BR03", name: "Overdue notice", bucket: "31-60", action: "WHATSAPP",
         triggerDpd: 31, template: "emi_overdue_notice", rbiRef: "RBI IRAC Master Circular (SMA-1 follow-up)" }),
    mk({ id: "BR04", name: "Follow-up call", bucket: "31-60", action: "VOICE",
         triggerDpd: 38, rbiRef: "RBI FPC — persistent but not harassing" }),
    mk({ id: "BR05", name: "PTP reminder", bucket: "31-60", action: "WHATSAPP",
         triggerDpd: 45, template: "promise_to_pay_reminder", rbiRef: "Internal policy — promise follow-up" }),
    mk({ id: "BR06", name: "Guarantor escalation", bucket: "61-90", action: "GUARANTOR",
         triggerDpd: g, rbiRef: "Indian Contract Act §126 — surety liability (consented contact only)" }),
    mk({ id: "BR07", name: "Firm reminder call", bucket: "61-90", action: "VOICE",
         triggerDpd: 65, rbiRef: "RBI IRAC (SMA-2) — pre-NPA engagement" }),
    mk({ id: "BR08", name: "Field visit (phone exhausted)", bucket: "61-90", action: "FIELD_VISIT",
         triggerDpd: g, rbiRef: "RBI outsourcing guidelines — ID card, civil hours, no coercion" }),
    mk({ id: "BR09", name: "NPA classification notice", bucket: "91-180", action: "WHATSAPP",
         triggerDpd: npa, template: "npa_warning_notice", rbiRef: "RBI IRAC — NPA at 90 DPD" }),
    mk({ id: "BR10", name: "Hardship/dispute human handoff", bucket: "91-180", action: "HUMAN_HANDOFF",
         triggerDpd: npa, rbiRef: "RBI FPC — grievance redressal path" }),
    mk({ id: "BR11", name: "SARFAESI 13(2) demand notice", bucket: "180+", action: "SARFAESI",
         triggerDpd: 181, rbiRef: "SARFAESI Act 2002 §13(2) — secured assets, NPA accounts" }),
    mk({ id: "BR12", name: "Settlement offer call", bucket: "180+", action: "VOICE",
         triggerDpd: 200, rbiRef: "Board-approved OTS policy" }),
  ];
}

/** Idempotent: install defaults if the store has no rules yet. */
export function ensureRules(): BusinessRule[] {
  const existing = listBusinessRules();
  if (existing.length > 0) return existing;
  const rules = defaultRules();
  saveBusinessRules(rules);
  return rules;
}

export function rulesDueForLoan(loan: { dpd: number }): BusinessRule[] {
  return ensureRules().filter(
    (r) => r.enabled && bucketFor(loan.dpd) === r.bucket && loan.dpd >= r.triggerDpd,
  );
}

export function toggleRule(id: string, enabled: boolean): BusinessRule | null {
  return updateBusinessRule(id, { enabled });
}
