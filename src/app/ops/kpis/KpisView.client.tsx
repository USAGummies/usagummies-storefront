"use client";

import { useEffect, useState } from "react";

type EngineData = {
  id: string;
  name: string;
  agentCount: number;
  recentRuns: number;
  successRate: number | null;
  failCount: number;
  lastRun: {
    agent?: string;
    name?: string;
    status?: string;
    at?: string;
    durationMs?: number;
  } | null;
};

type StatusData = {
  overall: string;
  totalAgents: number;
  healthCounts: { healthy: number; warning: number; critical: number; unknown: number };
  engines: EngineData[];
  generatedAt: string;
};

function BarChart({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{value}%</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

export function KpisView() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/ops/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Failed to load KPI data");
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const healthColor = (h: string) =>
    h === "healthy" ? "#4ade80" : h === "warning" ? "#fbbf24" : h === "critical" ? "#f87171" : "#6b7280";

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
          Key Performance Indicators
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          Agent performance and engine health metrics
          {data?.generatedAt ? ` · Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Health overview */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 32 }}>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>System Health</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: healthColor(data.overall), textTransform: "capitalize" }}>{data.overall}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Total Agents</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{data.totalAgents}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Healthy / Warning / Critical</div>
              <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>{data.healthCounts.healthy}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#fbbf24" }}>{data.healthCounts.warning}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#f87171" }}>{data.healthCounts.critical}</span>
              </div>
            </div>
          </div>

          {/* Engine success rates */}
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Engine Success Rates
          </h2>
          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", marginBottom: 32 }}>
            {data.engines.map((eng) => (
              <BarChart
                key={eng.id}
                label={`${eng.name} (${eng.agentCount} agents)`}
                value={eng.successRate ?? 0}
                max={100}
                color={
                  eng.successRate === null
                    ? "#6b7280"
                    : eng.successRate >= 90
                    ? "#4ade80"
                    : eng.successRate >= 70
                    ? "#fbbf24"
                    : "#f87171"
                }
              />
            ))}
          </div>

          {/* Engine cards */}
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Engine Details
          </h2>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {data.engines.map((eng) => (
              <div
                key={eng.id}
                style={{
                  background: "#1a1d27",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "18px 22px",
                  flex: "1 1 260px",
                  minWidth: 260,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{eng.name}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{eng.agentCount} agents</span>
                </div>
                <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>Runs</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{eng.recentRuns}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>Success</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: eng.successRate !== null && eng.successRate >= 80 ? "#4ade80" : "#fbbf24" }}>
                      {eng.successRate !== null ? `${eng.successRate}%` : "-"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>Fails</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: eng.failCount > 0 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{eng.failCount}</div>
                  </div>
                </div>
                {eng.lastRun && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10 }}>
                    Last: {eng.lastRun.name || eng.lastRun.agent || "Unknown"} — {eng.lastRun.status}
                    {eng.lastRun.at ? ` · ${new Date(eng.lastRun.at).toLocaleTimeString()}` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
