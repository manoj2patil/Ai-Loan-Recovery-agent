"use client";
// /login — session-mode sign-in. Posts to /api/auth (scrypt users, signed httpOnly
// cookie) and returns to the console. In AUTH_MODE=session the middleware sends
// unauthenticated visitors here.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username, password }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else setErr((await res.json()).error ?? "login failed");
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border bg-white p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Sah-Ayak · Sign in</h1>
          <p className="text-xs text-slate-500 mt-1">SKVCB Recovery Console — authorised officers only. Sessions are audited.</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">Username</span>
          <input className="mt-1 w-full border rounded px-3 py-2" autoComplete="username"
                 value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input type="password" className="mt-1 w-full border rounded px-3 py-2" autoComplete="current-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="text-sm text-red-700">⚠ {err}</p>}
        <button disabled={busy || !username || !password}
                className="w-full bg-indigo-600 text-white rounded py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-slate-400">
          Default dev users: officer1 · compliance1 · admin (see .env.example — change on install).
        </p>
      </form>
    </main>
  );
}
