import { useEffect, useState, type ReactElement } from "react";

type Session = {
  id: string;
  status: string;
  workflowId: string | null;
  principalId: string;
};

type Workflow = {
  id: string;
  recoveryState: string;
  orderId: string | null;
  principalId: string;
  version: number;
};

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const token =
  import.meta.env.VITE_API_TOKEN ?? "dev-api-token-change-me";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export function App(): ReactElement {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const [s, w] = await Promise.all([
        apiGet<Session[]>("/ops/sessions"),
        apiGet<Workflow[]>("/ops/workflows"),
      ]);
      setSessions(s);
      setWorkflows(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, []);

  const openWorkflow = async (id: string) => {
    setSelected(id);
    try {
      const d = await apiGet<Record<string, unknown>>(`/ops/workflows/${id}`);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "detail failed");
    }
  };

  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui",
        padding: "1.25rem",
        background: "#0b1220",
        color: "#e5e7eb",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Recoverable Agent Runtime — Ops</h1>
      <p style={{ color: "#9ca3af" }}>
        Session plane (blue) is not the workflow plane (amber). Resume never
        retries unknown effects.
      </p>
      {error && (
        <p role="alert" style={{ color: "#fca5a5" }}>
          {error} (start API with auth token; data appears after demos)
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
        }}
      >
        <section
          aria-label="session-state"
          style={{
            borderLeft: "4px solid #3b82f6",
            background: "#111827",
            padding: "1rem",
            borderRadius: 8,
          }}
        >
          <h2 style={{ color: "#93c5fd" }}>Sessions (ACP)</h2>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <code>{s.id}</code> — {s.status}
                {s.workflowId ? ` ↔ ${s.workflowId}` : ""}
              </li>
            ))}
            {sessions.length === 0 && <li>No sessions yet</li>}
          </ul>
        </section>

        <section
          aria-label="workflow-state"
          style={{
            borderLeft: "4px solid #f59e0b",
            background: "#111827",
            padding: "1rem",
            borderRadius: 8,
          }}
        >
          <h2 style={{ color: "#fcd34d" }}>Workflows (durable)</h2>
          <ul>
            {workflows.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => void openWorkflow(w.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#fde68a",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                  }}
                >
                  <code>{w.id}</code>
                </button>{" "}
                — <strong>{w.recoveryState}</strong> (v{w.version})
              </li>
            ))}
            {workflows.length === 0 && <li>No workflows yet</li>}
          </ul>
        </section>
      </div>

      {selected && detail && (
        <section
          style={{
            marginTop: "1.5rem",
            background: "#111827",
            padding: "1rem",
            borderRadius: 8,
            border: "1px solid #374151",
          }}
        >
          <h2>Workflow detail — lease, ledger, ops</h2>
          <p>
            Selected: <code>{selected}</code>
          </p>
          <pre
            style={{
              overflow: "auto",
              fontSize: 12,
              background: "#030712",
              padding: "0.75rem",
              borderRadius: 6,
            }}
          >
            {JSON.stringify(detail, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
