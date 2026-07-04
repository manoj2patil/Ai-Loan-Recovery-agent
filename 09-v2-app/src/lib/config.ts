// src/lib/config.ts — SystemConfig access (BUILD_STEPS Step 2). The rule values that drive
// the whole system live in the DB (seeded from the CBS export) — never hardcode them.

import { getDb } from "./store";

export function getConfig(key: string, fallback: string): string {
  return getDb().systemConfig.find((c) => c.key === key)?.value ?? fallback;
}

export function getConfigInt(key: string, fallback: number): number {
  const v = Number(getConfig(key, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
}

export const cfg = {
  bankName: () => getConfig("BANK_SHORT_NAME", "SKVCB"),
  callingHoursStart: () => getConfigInt("CALLING_HOURS_START", 9),
  callingHoursEnd: () => getConfigInt("CALLING_HOURS_END", 19),
  maxCallsPerDay: () => getConfigInt("MAX_CALLS_PER_DAY", 2),
  maxWhatsappPerDay: () => getConfigInt("MAX_WHATSAPP_PER_DAY", 3),
  guarantorDpdThreshold: () => getConfigInt("GUARANTOR_DPD_THRESHOLD", 60),
  npaDpdThreshold: () => getConfigInt("NPA_DPD_THRESHOLD", 90),
  sarfaesiNoticeDays: () => getConfigInt("SARFAESI_NOTICE_DAYS", 60),
};
