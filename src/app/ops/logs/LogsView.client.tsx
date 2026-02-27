"use client";

import { useState } from "react";
import { useLogsData } from "@/lib/ops/use-war-room-data";

const ENGINE_OPTIONS = [
  { value: "", label: "All Engines" },
  { value: "b2b", label: "B2B" },
  { value: "seo", label: "SEO" },
  { value: "dtc", label: "DTC" },
  { value: "supply-chain", label: "Supply Chain" },
  { value: "revenue-intel", label: "Revenue Intel" },
  { value: "finops", label: "FinOps" },
];

function StatusBadge({ status }: { status?: string }) {
  const s = status || "unknown";
  const colors: Record<string, { bg: string; fg: string }> = {
    success: { bg: "rgba(34,197,94,0.12)", fg: "#4ade80" },
    failed: { bg: "rgba(239,68,68,0.12)", fg: "#f87171" },
    running: { bg: "rgba(59,130,246,0.12)", fg: "#60a5fa" },
    skipped: { bg: "rgba(107,114,128,0.12)", fg: "#9ca3af" },
  };
  const c = colors[s] || { bg: "rgba(107,114,128,0.1)", fg: "#6b7280" };

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        padding: "2px 8px",
        borderRadius: 6,
        background: c.bg,
        color: c.fg,
        letterSpacing: "0.03em",
      }}
    >
      {s}
    </span>
  );
}

export function LogsView() {
  const [engine, setEngine] = useState("");
  const [tab, setTab] = useState<"runs" | "raw">("runs");
  const { data, loading, error, refresh } = useLogsData(engine, 200);

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
            Execution Logs
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>
            Agent run history and system events
            {data?.generatedAt ? ` · Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.85)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
            {[
              { label: "Total Runs", value: data.stats.total, color: "rgba(255,255,255,0.7)" },
              { label: "Last 24h", value: data.stats.last24h, color: "#60a5fa" },
              { label: "Successes (24h)", value: data.stats.successes24h, color: "#4ade80" },
              { label: "Failures (24h)", value: data.stats.failures24h, color: "#f87171" },
            ].map((s) => (
              <div key={s.label} style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 140px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              style={{
                background: "#1a1d27",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {ENGINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <div style={{ display: "flex", background: "#1a1d27", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              {(["runs", "raw"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: tab === t ? "rgba(255,255,255,0.08)" : "transparent",
                    color: tab === t ? "#fff" : "rgba(255,255,255,0.4)",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "capitalize",
                  }}
                >
                  {t === "runs" ? "Run History" : "Raw Log"}
                </button>
              ))}
            </div>
          </div>

          {tab === "runs" && (
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
              {loading && (
                <div style={{ padding: "20px", color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center" }}>Loading...</div>
              )}
              {!loading && data.runs.length === 0 && (
                <div style={{ padding: "32px 20px", color: "rgba(255,255,255,0.25)", fontSize: 13, textAlign: "center" }}>No runs found</div>
              )}
              {data.runs.map((run, i) => (
                <div
                  key={`${run.startedAt || run.runAt}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 18px",
                    borderBottom: i < data.runs.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                  }}
                >
                  <StatusBadge status={run.status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>
                      {run.agentName || run.label || run.agent || run.agentKey || "Unknown"}
                    </div>
                    {run.error && (
                      <div style={{ fontSize: 11, color: "#f87171", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {run.error}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                    {run.engineId || ""}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                    {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", whiteSpace: "nowrap", minWidth: 60, textAlign: "right" }}>
                    {run.runAtET || (run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "raw" && (
            <div
              style={{
                background: "#0d0f14",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "16px 20px",
                maxHeight: 500,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.7,
                color: "rgba(255,255,255,0.5)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {data.engineLog.length === 0 ? "No log entries" : data.engineLog.join("\n")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
