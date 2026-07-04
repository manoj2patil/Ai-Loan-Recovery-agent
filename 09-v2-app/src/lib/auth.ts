// src/lib/auth.ts — RBAC for the v2 write routes (ROADMAP_V2 Phase 1 ★ security posture).
// Roles: officer < compliance < admin. Every v2 write route calls requireRole().
//
// DEV IMPLEMENTATION: the role comes from the `x-role` header (or DEFAULT_ROLE env) and the
// actor from `x-actor`. In production, replace resolveActor() with your session/SSO lookup —
// the requireRole() contract stays the same.

import { Role } from "./store";

const RANK: Record<Role, number> = { officer: 1, compliance: 2, admin: 3 };

export interface Actor { name: string; role: Role }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function resolveActor(req: Request): Actor {
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
