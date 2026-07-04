"use client";
// Header session widget: shows the resolved actor (cookie session or dev header mode)
// with a logout action when a real session is active.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SessionBadge() {
  const router = useRouter();
  const [state, setState] = useState<{ actor?: { name: string; role: string }; mode?: string }>({});

  useEffect(() => {
    fetch("/api/auth").then((r) => r.json()).then(setState).catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login");
  }

  if (!state.actor) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span className="px-2 py-0.5 rounded-full bg-slate-100">
        {state.actor.name} · {state.actor.role}{state.mode === "header" ? " · dev" : ""}
      </span>
      {state.mode === "session"
        ? <button onClick={logout} className="text-indigo-700 underline">logout</button>
        : <a href="/login" className="text-indigo-700 underline">sign in</a>}
    </div>
  );
}
