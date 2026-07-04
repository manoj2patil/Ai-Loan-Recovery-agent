// Dashboard — V2_INTEGRATION §6: mount <V2Sections /> next to the Intelligence section.
// In the full app this page also hosts the v1 sections; here it hosts the v2 modules.

import V2Sections from "@components/V2Sections";

export default function Dashboard() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Sah-Ayak · Recovery Console</h1>
        <p className="text-sm text-slate-600">
          v2 gap modules — payments closure · legal tracker · field collections. All writes are
          RBAC-guarded and audit-logged; every outreach passes the Compliance Gate (with DND scrub).
        </p>
      </header>
      <V2Sections />
    </main>
  );
}
