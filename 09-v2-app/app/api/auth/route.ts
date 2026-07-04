// POST /api/auth — { action: "login", username, password } → sets the signed httpOnly
//                  session cookie; { action: "logout" } → clears it (both audited).
// GET  /api/auth — current actor (from cookie or dev header mode).

import { NextResponse } from "next/server";
import { login, resolveActor, HttpError, SESSION_COOKIE } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    return NextResponse.json({ actor: resolveActor(req), mode: process.env.AUTH_MODE === "session" ? "session" : "header" });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "login") {
      const { token, user } = login(String(body.username ?? ""), String(body.password ?? ""));
      const res = NextResponse.json({ ok: true, user });
      res.headers.set("Set-Cookie",
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 3600}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
      return res;
    }

    if (body.action === "logout") {
      try {
        const actor = resolveActor(req);
        writeAudit({ actor: actor.name, role: actor.role, action: "SESSION_LOGOUT", entity: "User" });
      } catch { /* expired session logging out — fine */ }
      const res = NextResponse.json({ ok: true });
      res.headers.set("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return res;
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
