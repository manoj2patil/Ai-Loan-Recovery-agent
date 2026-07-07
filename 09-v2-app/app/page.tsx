// Dashboard — the full recovery console: v1 operations (portfolio, borrower 360,
// orchestrator & rules, governance) with the v2 gap modules mounted alongside
// (V2_INTEGRATION §6). Seeded from the real CBS export.

import V1Sections from "@components/V1Sections";
import V2Sections from "@components/V2Sections";
import NetworkPilotSections from "@components/NetworkPilotSections";
import SessionBadge from "@components/SessionBadge";

export default function Dashboard() {
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold">Sah-Ayak · Recovery Console</h1>
          <SessionBadge />
        </div>
        <p className="text-sm text-slate-600">
          Portfolio · orchestration · intelligence · payments · legal · field · NACH. All writes
          RBAC-guarded and audit-logged; every outreach passes the Compliance Gate (DND-scrubbed,
          SystemConfig-driven). Voice dispatch is env-driven: simulated in dev, Twilio Media
          Streams / LiveKit + Sarvam in production.
        </p>
      </header>
      <V1Sections />
      <V2Sections />
      <NetworkPilotSections />
    </main>
  );
}
