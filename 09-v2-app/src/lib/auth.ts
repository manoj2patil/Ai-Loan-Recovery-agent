// src/lib/auth.ts — RBAC + session auth (ROADMAP Phase 1 ★ / Phase 6 hardening).
// Roles: officer < compliance < admin. Every v2 write route calls requireRole().
//
// Two modes (AUTH_MODE):
//   "header"  (dev default)  — role from the x-role header; keeps demos/tests friction-free.
//   "session" (enterprise)   — ONLY signed httpOnly session cookies are accepted; the
//                              header fallback is disabled. Set SESSION_SECRET.
// Users live in the store with scrypt password hashes; logins/logouts/failures are audited
// (session audit is table stakes in bank RFPs).

import crypto from "crypto";
import { getDb, persist, newId, Role, UserRow } from "./store";
import { writeAudit } from "./audit";

const RANK: Record<Role, number> = { officer: 1, compliance: 2, admin: 3 };
const SESSION_TTL_MS = 8 * 3600 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret-change-me";
export const SESSION_COOKIE = "sahayak_session";

export interface Actor { name: string; role: Role }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ---- password hashing (scrypt, per-user salt) ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

/** Seed the three default users on first touch. CHANGE THE PASSWORDS on install —
 *  defaults come from env (DEFAULT_*_PASSWORD) or a well-known dev value. */
export function ensureUsers(): UserRow[] {
  const db = getDb();
  if (db.users.length > 0) return db.users;
  const mk = (username: string, name: string, role: Role, envKey: string): UserRow => ({
    id: newId("usr"), username, name, role,
    passwordHash: hashPassword(process.env[envKey] || "ChangeMe123!"),
    active: true, createdAt: new Date().toISOString(),
  });
  db.users.push(
    mk("officer1", "Recovery Officer", "officer", "DEFAULT_OFFICER_PASSWORD"),
    mk("compliance1", "Compliance Officer", "compliance", "DEFAULT_COMPLIANCE_PASSWORD"),
    mk("admin", "Administrator", "admin", "DEFAULT_ADMIN_PASSWORD"),
  );
  persist();
  return db.users;
}

// ---- signed session tokens: base64url(payload).hmac ----
function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(user: UserRow): string {
  const payload = Buffer.from(JSON.stringify({
    u: user.username, n: user.name, r: user.role, exp: Date.now() + SESSION_TTL_MS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): Actor | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (!RANK[data.r as Role]) return null;
    return { name: `${data.n} (${data.u})`, role: data.r as Role };
  } catch { return null; }
}

export function login(username: string, password: string): { token: string; user: { username: string; name: string; role: Role } } {
  ensureUsers();
  const user = getDb().users.find((u) => u.username === username && u.active);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    writeAudit({ actor: username, role: "officer", action: "SESSION_LOGIN_FAILED", entity: "User" });
    throw new HttpError(401, "invalid credentials");
  }
  user.lastLoginAt = new Date().toISOString();
  persist();
  writeAudit({ actor: user.username, role: user.role, action: "SESSION_LOGIN", entity: "User", entityId: user.id });
  return { token: createSessionToken(user), user: { username: user.username, name: user.name, role: user.role } };
}

// ---- request → actor ----
function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function resolveActor(req: Request): Actor {
  // 1) signed session cookie (always accepted)
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) {
    const actor = verifySessionToken(token);
    if (actor) return actor;
    if (process.env.AUTH_MODE === "session") throw new HttpError(401, "session expired — log in again");
  }
  // 2) dev header fallback — disabled in enterprise session mode
  if (process.env.AUTH_MODE === "session") throw new HttpError(401, "authentication required");
  const role = (req.headers.get("x-role") || process.env.DEFAULT_ROLE || "officer") as Role;
  if (!RANK[role]) throw new HttpError(401, `unknown role '${role}'`);
  return { name: req.headers.get("x-actor") || "dev-user", role };
}

/** Throws 403 unless the caller's role is at least `min`. Returns the actor for auditing. */
export function requireRole(req: Request, min: Role): Actor {
  const actor = resolveActor(req);
  if (RANK[actor.role] < RANK[min])
    throw new HttpError(403, `requires role '${min}' or higher (you are '${actor.role}')`);
  return actor;
}
