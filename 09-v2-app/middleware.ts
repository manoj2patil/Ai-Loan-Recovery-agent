// middleware.ts — Phase 6 hardening: security headers on every response + a simple
// per-IP rate limit on the API surface. In-memory buckets are per-instance, which fits
// the single-node on-prem deployment; front with the LB's limiter when clustering.

import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const MAX_REQ = Number(process.env.RATE_LIMIT_PER_MIN || 300);
const buckets = new Map<string, { count: number; resetAt: number }>();

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || b.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else if (++b.count > MAX_REQ) {
      return new NextResponse(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((b.resetAt - now) / 1000)) },
      });
    }
    if (buckets.size > 10_000) buckets.clear(); // bound memory
  }

  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
