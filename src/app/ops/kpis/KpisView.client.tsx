"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  Mail,
  CheckCircle2,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import { useAlerts, useAuditStatus } from "@/lib/ops/use-war-room-data";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";

const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const BG = "#f8f5ef";
const CARD = "#ffffff";
const BORDER = "rgba(27,42,74,0.08)";
const TEXT_DIM = "rgba(27,42,74,0.56)";

type PriorityFilter = "all" | "critical" | "warning" | "info";

type ActionLog = {
  id: string;
  title: string;
  action: string;
  at: string;
};

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div
        style={{
          fontSize: 11,
          color: TEXT_DIM,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

export function KpisView() {
  const [filter, setFilter] = useState<PriorityFilter>("all");
  const [log, setLog] = useState<ActionLog[]>([]);

  const {
    data: alerts,
    loading: alertsLoading,
    error: alertsError,
    refresh: refreshAlerts,
  } = useAlerts(100);
  const {
    data: audit,
    loading: auditLoading,
    error: auditError,
    refresh: refreshAudit,
  } = useAuditStatus();

  const visibleAlerts = useMemo(() => {
    const rows = alerts?.alerts || [];
    if (filter === "all") return rows;
    return rows.filter((a) => a.priority === filter);
  }, [alerts, filter]);
  const freshnessItems = [
    { label: "Alerts", timestamp: alerts?.lastFetched },
    { label: "Audit", timestamp: audit?.lastFetched },
  ];

  function markDone(id: string, title: string) {
    setLog((prev) => [
      {
        id,
        title,
        action: "Marked complete",
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  function draftEmail(title: string, message: string) {
    const subject = `Action required: ${title}`;
    const body = `Hi team,\n\nPlease review this alert:\n\n${title}\n${message}\n\nThanks.`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    setLog((prev) => [
      {
        id: `${Date.now()}`,
        title,
        action: "Drafted follow-up email",
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Alerts & Actions</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Unified operational inbox with priority triage and action log.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>

        <button
          onClick={() => {
            refreshAlerts();
            refreshAudit();
          }}
          style={{
            border: "none",
            borderRadius: 8,
            background: NAVY,
            color: "#fff",
            padding: "10px 14px",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {(alertsError || auditError) ? (
        <div
          style={{
            border: `1px solid ${RED}33`,
            background: `${RED}14`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
          }}
        >
          <AlertTriangle size={16} />
          {alertsError || auditError}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Critical" value={String(alerts?.summary.critical || 0)} color={RED} />
        <MetricCard label="Warning" value={String(alerts?.summary.warning || 0)} color={GOLD} />
        <MetricCard label="Info" value={String(alerts?.summary.info || 0)} color={NAVY} />
        <MetricCard label="Audit Failures" value={String(audit?.summary.failed || 0)} color={RED} />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {(["all", "critical", "warning", "info"] as PriorityFilter[]).map((p) => {
            const active = p === filter;
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                style={{
                  border: `1px solid ${active ? NAVY : BORDER}`,
                  background: active ? NAVY : CARD,
                  color: active ? "#fff" : NAVY,
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  cursor: "pointer",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        {(visibleAlerts || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            {alertsLoading ? "Loading alerts..." : "No alerts in this filter."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {visibleAlerts.map((alert) => (
              <div key={alert.id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 99,
                          background:
                            alert.priority === "critical"
                              ? RED
                              : alert.priority === "warning"
                                ? GOLD
                                : "#16a34a",
                        }}
                      />
                      <span style={{ color: NAVY, fontWeight: 700, fontSize: 14 }}>{alert.title}</span>
                    </div>
                    <div style={{ marginTop: 4, color: TEXT_DIM, fontSize: 13 }}>{alert.message}</div>
                    <div style={{ marginTop: 4, color: TEXT_DIM, fontSize: 12 }}>
                      {alert.source} • {new Date(alert.createdAt).toLocaleString("en-US")}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 165 }}>
                    <button
                      onClick={() => draftEmail(alert.title, alert.message)}
                      style={{
                        border: "none",
                        borderRadius: 8,
                        background: NAVY,
                        color: "#fff",
                        padding: "7px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        display: "inline-flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                      }}
                    >
                      <Mail size={12} />
                      Draft Email
                    </button>
                    <button
                      onClick={() => markDone(alert.id, alert.title)}
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 8,
                        background: CARD,
                        color: NAVY,
                        padding: "7px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        display: "inline-flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                      }}
                    >
                      <CheckCircle2 size={12} />
                      Mark Done
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <ShieldAlert size={16} color={NAVY} />
            <div style={{ fontWeight: 700, color: NAVY }}>Data Freshness</div>
          </div>

          {(audit?.freshness || []).length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>{auditLoading ? "Loading audit..." : "No freshness records yet."}</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {(audit?.freshness || []).map((row) => (
                <div key={row.stateKey} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{row.source}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 12 }}>
                      {row.lastFetched ? new Date(row.lastFetched).toLocaleString("en-US") : "Missing cache"}
                    </div>
                  </div>
                  <div
                    style={{
                      color:
                        row.status === "critical"
                          ? RED
                          : row.status === "stale"
                            ? GOLD
                            : row.status === "missing"
                              ? RED
                              : "#16a34a",
                      fontWeight: 800,
                      fontSize: 12,
                      textTransform: "uppercase",
                    }}
                  >
                    {row.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Clock3 size={16} color={NAVY} />
            <div style={{ fontWeight: 700, color: NAVY }}>Action Log</div>
          </div>

          {log.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No completed actions yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {log.slice(0, 20).map((entry, idx) => (
                <div key={`${entry.id}-${idx}`} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{entry.title}</div>
                  <div style={{ color: TEXT_DIM, fontSize: 12 }}>{entry.action}</div>
                  <div style={{ color: TEXT_DIM, fontSize: 11 }}>{new Date(entry.at).toLocaleString("en-US")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
