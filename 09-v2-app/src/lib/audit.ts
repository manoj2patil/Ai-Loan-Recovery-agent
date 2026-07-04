// src/lib/audit.ts — session audit + PII masking (ROADMAP_V2 Phase 1 ★).
// Every v2 write is audit-logged; list views mask phone numbers and names.

import { getDb, persist, newId, Role } from "./store";

export function writeAudit(opts: {
  actor: string; role: Role; action: string; entity: string; entityId?: string; details?: unknown;
}): void {
  getDb().auditLog.push({ ...opts, id: newId("aud"), at: new Date().toISOString() });
  persist();
}

/** +919224931447 → +91XXXXXX1447 */
export function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{2})\d+(\d{4})$/, "$1XXXXXX$2");
}

/** "Rema Thampi" → "Rema T." */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
