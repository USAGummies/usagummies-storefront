"use client";

import { useEffect, useState } from "react";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { useIsMobile } from "@/app/ops/hooks";

type ProactiveAlert = {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  data: Record<string, unknown>;
  dedupKey: string;
  timestamp?: string;
};

type AgentHealthItem = {
  engineId: string;
  agentKey: string;
  agentName: string;
  health: "healthy" | "degraded" | "failing" | "inactive";
  consecutiveFailures: number;
  disabled: boolean;
  last7Days: {
    runs: number;
    successes: number;
    failures: number;
    successRate: number;
    avgDurationMs: number;
  };
  lastRun: { status: string; timestamp: string; error?: string } | null;
};

type DeadLetterItem = {
  id: string;
  engineId: string;
  agentKey: string;
  agentName: string;
  failedAt: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  status: string;
};

function severityIcon(s: string) {
  if (s === "critical") return "\u{1F6A8}";
  if (s === "warning") return "\u26A0\uFE0F";
  return "\u2139\uFE0F";
}

function severityColor(s: string) {
  if (s === "critical") return RED;
  if (s === "warning") return GOLD;
  return "#3b82f6";
}

function healthColor(h: string) {
  if (h === "healthy") return "#16a34a";
  if (h === "degraded") return GOLD;
  if (h === "failing") return RED;
  return TEXT_DIM;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AlertsView() {
  const isMobile = useIsMobile();
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [agents, setAgents] = useState<AgentHealthItem[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [alertsRes, agentsRes, dlRes] = await Promise.allSettled([
        fetch("/api/ops/abra/proactive-alerts", { cache: "no-store" }),
        fetch("/api/ops/agent-health?failing=1", { cache: "no-store" }),
        fetch("/api/ops/abra/dead-letter", { cache: "no-store" }),
      ]);

      if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
        const data = await alertsRes.value.json();
        setAlerts(data.alerts || []);
      }
      if (agentsRes.status === "fulfilled" && agentsRes.value.ok) {
        const data = await agentsRes.value.json();
        setAgents(data.agents || []);
      }
      if (dlRes.status === "fulfilled" && dlRes.value.ok) {
        const data = await dlRes.value.json();
        setDeadLetters((data.items || []).filter((i: DeadLetterItem) => i.status === "pending"));
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }

  async function runScan() {
    setScanning(true);
    try {
      await fetch("/api/ops/abra/proactive-alerts", { method: "POST" });
      await loadAll();
    } catch {
      // best-effort
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const failingAgents = agents.filter((a) => a.health === "failing").length;
  const degradedAgents = agents.filter((a) => a.health === "degraded").length;

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: NAVY, fontWeight: 800 }}>Alerts & Health</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Proactive monitoring, agent health, and dead letter queue.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              background: NAVY,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: scanning ? "not-allowed" : "pointer",
              opacity: scanning ? 0.6 : 1,
            }}
          >
            {scanning ? "Scanning..." : "Run Alert Scan"}
          </button>
          <RefreshButton onClick={loadAll} loading={loading} />
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Critical Alerts", value: String(criticalCount), color: criticalCount > 0 ? RED : "#16a34a" },
          { label: "Warnings", value: String(warningCount), color: warningCount > 0 ? GOLD : "#16a34a" },
          { label: "Failing Agents", value: String(failingAgents), color: failingAgents > 0 ? RED : "#16a34a" },
          { label: "Dead Letters", value: String(deadLetters.length), color: deadLetters.length > 0 ? GOLD : "#16a34a" },
        ].map((card) => (
          <div key={card.label} style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "12px 14px",
            borderLeft: `4px solid ${card.color}`,
          }}>
            <div style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {card.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color, marginTop: 2 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, textAlign: "center", color: TEXT_DIM }}>
          Loading alerts...
        </div>
      ) : (
        <>
          {/* Proactive Alerts */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 15 }}>
              Proactive Alerts {alerts.length > 0 && <span style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 400 }}>({alerts.length})</span>}
            </div>
            {alerts.length === 0 ? (
              <div style={{ color: "#16a34a", fontSize: 13, padding: "10px 0" }}>
                All clear — no active alerts.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {alerts.map((alert) => (
                  <div key={alert.id} style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    borderLeft: `4px solid ${severityColor(alert.severity)}`,
                    background: BG,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                          {severityIcon(alert.severity)} {alert.title}
                        </div>
                        <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>{alert.message}</div>
                      </div>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: severityColor(alert.severity),
                        flexShrink: 0,
                        marginLeft: 8,
                      }}>
                        {alert.severity}
                      </span>
                    </div>
                    {alert.timestamp && (
                      <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 4 }}>{timeAgo(alert.timestamp)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agent Health */}
          {(failingAgents > 0 || degradedAgents > 0) && (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 15 }}>
                Degraded Agents ({agents.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: TEXT_DIM, fontWeight: 700 }}>Agent</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: TEXT_DIM, fontWeight: 700 }}>Health</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: TEXT_DIM, fontWeight: 700 }}>Success Rate</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: TEXT_DIM, fontWeight: 700 }}>Consec. Fails</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: TEXT_DIM, fontWeight: 700 }}>Last Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={`${agent.engineId}-${agent.agentKey}`} style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: "6px 8px", color: NAVY, fontWeight: 600 }}>
                          {agent.agentName || agent.agentKey}
                          <div style={{ fontSize: 10, color: TEXT_DIM }}>{agent.engineId}/{agent.agentKey}</div>
                        </td>
                        <td style={{ textAlign: "center", padding: "6px 8px" }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#fff",
                            background: healthColor(agent.health),
                          }}>
                            {agent.health}{agent.disabled ? " (disabled)" : ""}
                          </span>
                        </td>
                        <td style={{ textAlign: "center", padding: "6px 8px", color: NAVY, fontWeight: 700 }}>
                          {agent.last7Days.runs > 0 ? `${agent.last7Days.successRate.toFixed(0)}%` : "—"}
                        </td>
                        <td style={{ textAlign: "center", padding: "6px 8px", color: agent.consecutiveFailures >= 5 ? RED : NAVY, fontWeight: 700 }}>
                          {agent.consecutiveFailures}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 11, color: TEXT_DIM, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {agent.lastRun?.error?.slice(0, 100) || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dead Letter Queue */}
          {deadLetters.length > 0 && (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 15 }}>
                Dead Letter Queue ({deadLetters.length} pending)
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {deadLetters.map((dl) => (
                  <div key={dl.id} style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: BG,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                        {dl.agentName || dl.agentKey}
                        <span style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 400, marginLeft: 6 }}>
                          ({dl.engineId}/{dl.agentKey})
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: TEXT_DIM }}>
                        Retry {dl.retryCount}/{dl.maxRetries}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: RED, marginTop: 4 }}>{dl.errorMessage.slice(0, 200)}</div>
                    <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 3 }}>Failed {timeAgo(dl.failedAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All clear state */}
          {alerts.length === 0 && agents.length === 0 && deadLetters.length === 0 && (
            <div style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: "40px 20px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>&#x2705;</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>All Systems Healthy</div>
              <div style={{ fontSize: 13, color: TEXT_DIM, marginTop: 4 }}>
                No alerts, no failing agents, no dead letters.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
