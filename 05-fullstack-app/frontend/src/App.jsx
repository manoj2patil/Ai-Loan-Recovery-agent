import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS = API.replace(/^http/, "ws");

export default function App() {
  const [borrowers, setBorrowers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/borrowers`)
      .then((r) => r.json())
      .then(setBorrowers)
      .catch(() => setStatus("Failed to load borrowers"));
  }, []);

  async function placeCall(b) {
    setSelected(b);
    setEvents([]);
    setStatus("Checking compliance…");
    const res = await fetch(`${API}/api/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: b.phone, test_mode: true }),
    }).then((r) => r.json());

    if (!res.ok) {
      setStatus(`Blocked by gate: ${res.gate || res.error}`);
      return;
    }
    setStatus(`Calling ${res.borrower}…`);
    setLanguage(res.language);

    // Live transcript / status feed
    const ws = new WebSocket(`${WS}/ws/call/${res.call_id}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "lang") setLanguage(msg.language);
      if (msg.type === "status") setStatus(msg.state);
      setEvents((prev) => [...prev, msg]);
    };
    ws.onclose = () => setStatus("Call ended");
  }

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Sah-Ayak — Recovery Console</h1>

      <div style={S.grid}>
        {/* Borrower list */}
        <div style={S.card}>
          <h2 style={S.h2}>Borrowers</h2>
          <table style={S.table}>
            <thead>
              <tr><th>Name</th><th>Loan</th><th>DPD</th><th>Pending</th><th></th></tr>
            </thead>
            <tbody>
              {borrowers.map((b) => (
                <tr key={b.id} style={selected?.id === b.id ? S.rowSel : undefined}>
                  <td>{b.name}</td>
                  <td>{b.loanId}</td>
                  <td>{b.dpd}</td>
                  <td>₹{Number(b.pendingAmount || 0).toLocaleString("en-IN")}</td>
                  <td><button style={S.btn} onClick={() => placeCall(b)}>Call</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Live call panel */}
        <div style={S.card}>
          <h2 style={S.h2}>Live Call</h2>
          {selected ? (
            <>
              <p><b>{selected.name}</b> · {selected.phone}</p>
              <p>Status: <span style={S.pill}>{status}</span></p>
              <p>Language: <span style={S.pillBlue}>{language || "—"}</span></p>
              <div style={S.transcript}>
                {events.length === 0 && <em>Live transcript will appear here…</em>}
                {events.map((e, i) => (
                  <div key={i} style={S.line}>
                    <span style={S.tag}>{e.type}</span> {e.transcript || e.data || e.state || ""}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <em>Select a borrower and press Call.</em>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto", padding: 24, color: "#1a1a1a" },
  h1: { fontSize: 22, marginBottom: 16 },
  h2: { fontSize: 16, marginBottom: 10 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  card: { border: "1px solid #e5e5e5", borderRadius: 10, padding: 16, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  rowSel: { background: "#eef6ff" },
  btn: { padding: "4px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" },
  pill: { background: "#f1f5f9", padding: "2px 8px", borderRadius: 999 },
  pillBlue: { background: "#dbeafe", padding: "2px 8px", borderRadius: 999 },
  transcript: { marginTop: 10, height: 280, overflowY: "auto", background: "#fafafa", borderRadius: 8, padding: 10, fontSize: 14 },
  line: { marginBottom: 6 },
  tag: { fontSize: 11, color: "#64748b", marginRight: 6, textTransform: "uppercase" },
};
