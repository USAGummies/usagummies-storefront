"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./agentic-command-center.module.css";

const COMMAND_CENTER_BUILD = "CC-BUILD-2026-02-23-02";

type AgentRow = {
  key: string;
  label: string;
  schedule: {
    label: string;
    hour?: number;
    minute?: number;
    graceMinutes: number;
    intervalMinutes?: number;
  };
  state: {
    lastStatus?: string;
    lastRunAtET?: string;
    lastDurationMs?: number;
    summary?: string;
    lastError?: string;
    source?: string;
  } | null;
  health: {
    level: "healthy" | "warning" | "critical" | "unknown";
    reason: string;
    stale: boolean;
    minutesSinceRun: number | null;
  };
  indicator: {
    level: "active" | "idle" | "error";
    label: "Active" | "Idle" | "Error";
    reason: string;
  };
  nextRunAtET: string;
};

type WeekGoals = {
  weekStart: string;
  weekEnd: string;
  distributor: { target: number; conversations: number; names: string[] };
  b2b: { target: number; orders: number };
  inderbitzin: {
    status: string;
    lastContactedDate: string;
    followUpSent: boolean;
    replyReceived: boolean;
    nextAction: string;
  };
  fetchedAt: string;
  error?: string;
};

type Payload = {
  generatedAtET: string;
  overall: "healthy" | "warning" | "critical";
  counts: {
    healthy: number;
    warning: number;
    critical: number;
    unknown: number;
  };
  indicatorCounts: {
    active: number;
    idle: number;
    error: number;
  };
  proofOfLife: {
    heartbeatAt: string;
    heartbeatSource: string;
    selfHealLastRunAt: string;
    selfHealSummary: string;
  };
  cron: {
    installed: boolean;
    unknown?: boolean;
    lines: string[];
  };
  agents: AgentRow[];
  recentEvents: Array<{ at: string; agent: string; status: string; summary: string }>;
  selfHeal: {
    actions?: string[];
  };
  kpis: {
    today: string;
    todayMetrics: {
      leadsCultivated: number;
      b2bEmailsSent: number;
      distributorEmailsSent: number;
      followupEmailsSent: number;
      totalEmailsSent: number;
      repliesProcessed: number;
      repliesInterested: number;
      repliesNotInterested: number;
      repliesBounced: number;
      inboxScanned: number;
      inboxUnmatched: number;
      inboxUnmatchedBounces: number;
      failedDeliveries: number;
      fairOrdersLogged: number;
      b2bSendFloor: number;
      distributorSendFloor: number;
      b2bFloorShortfall: number;
      distributorFloorShortfall: number;
      floorMet: boolean;
    };
    cumulativeMetrics: {
      leadsCultivated: number;
      b2bEmailsSent: number;
      distributorEmailsSent: number;
      followupEmailsSent: number;
      emailsSent: number;
      repliesProcessed: number;
      repliesInterested: number;
      repliesNotInterested: number;
      repliesBounced: number;
      inboxScanned: number;
      inboxUnmatched: number;
      inboxUnmatchedBounces: number;
      failedDeliveries: number;
      fairOrdersLogged: number;
    };
  };
  attentionQueue: {
    pendingCount: number;
    interestedCount: number;
    otherCount: number;
    notInterestedCount: number;
    items: Array<{
      queueId: string;
      queuedAtET: string;
      receivedAtET: string;
      senderEmail: string;
      subject: string;
      category: string;
      prospectType: string;
      prospectName: string;
      recommendedAction: string;
      draftSubject: string;
      draftBody: string;
      authorizationRequired: boolean;
      status: string;
    }>;
  };
  weekGoals?: WeekGoals;
  systemStatus: {
    level: "running" | "degraded" | "error";
    label: "RUNNING" | "DEGRADED" | "ERROR";
    checks: Array<{
      key: string;
      label: string;
      status: "pass" | "fail" | "unknown";
      ok: boolean;
      details: string;
    }>;
  };
  operatorControl: {
    level: "running" | "degraded" | "error";
    label: "RUNNING" | "DEGRADED" | "ERROR";
    owner: string;
    controlMode: string;
    replyPolicy: string;
    checks: Array<{
      key: string;
      label: string;
      ok: boolean;
      details: string;
    }>;
    stats: {
      manualRuns24h: number;
      automatedRuns24h: number;
      totalRuns24h: number;
      lastManualRunAtET: string;
      lastManualAgent: string;
      trainingUpdatedAtET: string;
      trainingNotesCount: number;
      recentTrainingNotes: string[];
    };
  };
  commandCenter: {
    healthy: boolean;
    trackedPid: number | null;
    trackedPidAlive: boolean;
    trackedPidCommand: string;
    listenerPid: number | null;
    listenerCommand: string;
    watchdogLogUpdatedAt: string;
    recentWatchdogLogs: string[];
  };
  logs: string[];
  paths: {
    statusFile: string;
    logFile: string;
    commandCenterPidFile?: string;
    commandCenterLogFile?: string;
  };
  freshness: Array<{
    key: string;
    label: string;
    state: "fresh" | "stale" | "unknown";
    ageMinutes: number | null;
    staleAfterMinutes: number;
    details: string;
  }>;
};

function badgeClass(level: string) {
  if (level === "healthy") return `${styles.badge} ${styles.badgeHealthy}`;
  if (level === "warning") return `${styles.badge} ${styles.badgeWarning}`;
  if (level === "critical") return `${styles.badge} ${styles.badgeCritical}`;
  return `${styles.badge} ${styles.badgeUnknown}`;
}

function textClass(level: string) {
  if (level === "healthy") return styles.statusHealthy;
  if (level === "warning") return styles.statusWarning;
  if (level === "critical") return styles.statusCritical;
  return styles.statusUnknown;
}

function indicatorBadgeClass(level: string) {
  if (level === "active") return `${styles.badge} ${styles.badgeWarning}`;
  if (level === "error") return `${styles.badge} ${styles.badgeCritical}`;
  return `${styles.badge} ${styles.badgeUnknown}`;
}

function systemBadgeClass(level: string) {
  if (level === "running") return `${styles.badge} ${styles.badgeHealthy}`;
  if (level === "degraded") return `${styles.badge} ${styles.badgeWarning}`;
  return `${styles.badge} ${styles.badgeCritical}`;
}

function freshnessBadgeClass(level: "fresh" | "stale" | "unknown") {
  if (level === "fresh") return `${styles.badge} ${styles.badgeHealthy}`;
  if (level === "stale") return `${styles.badge} ${styles.badgeCritical}`;
  return `${styles.badge} ${styles.badgeUnknown}`;
}

function formatSchedule(agent: AgentRow) {
  if (agent.schedule.intervalMinutes) {
    return `Every ${agent.schedule.intervalMinutes} min`;
  }
  const hour = String(agent.schedule.hour ?? 0).padStart(2, "0");
  const minute = String(agent.schedule.minute ?? 0).padStart(2, "0");
  return `${hour}:${minute} ET`;
}

function GoalBar({ value, target, label }: { value: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const color = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "0.85rem" }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value} / {target}</span>
      </div>
      <div style={{ height: "8px", background: "#333", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "4px", transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function WeekGoalsPanel({ goals }: { goals: WeekGoals }) {
  const inderColor = goals.inderbitzin.replyReceived ? "#22c55e"
    : goals.inderbitzin.followUpSent ? "#f59e0b"
    : "#ef4444";
  const distDone = goals.distributor.conversations >= goals.distributor.target;
  const b2bDone = goals.b2b.orders >= goals.b2b.target;
  const allDone = distDone && b2bDone && goals.inderbitzin.replyReceived;

  return (
    <section className={styles.panel} style={{ border: "2px solid #f59e0b", background: "#1a1200" }}>
      <h2 className={styles.panelTitle} style={{ color: "#f59e0b" }}>
        🏆 Week Mission: {goals.weekStart} → {goals.weekEnd} — Funding Targets
        {allDone && <span style={{ marginLeft: "12px", color: "#22c55e" }}>✓ ALL COMPLETE</span>}
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "12px" }}>
        {/* Distributor Goal */}
        <div style={{ background: "#111", borderRadius: "8px", padding: "16px", border: `1px solid ${distDone ? "#22c55e" : "#ef4444"}` }}>
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "8px" }}>DISTRIBUTOR CONVERSATIONS</div>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: distDone ? "#22c55e" : "#ef4444", marginBottom: "8px" }}>
            {goals.distributor.conversations} / {goals.distributor.target}
          </div>
          <GoalBar value={goals.distributor.conversations} target={goals.distributor.target} label="Started" />
          {goals.distributor.names.length > 0 && (
            <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
              {goals.distributor.names.slice(0, 3).join(", ")}
              {goals.distributor.names.length > 3 && ` +${goals.distributor.names.length - 3} more`}
            </div>
          )}
          {goals.distributor.names.length === 0 && (
            <div style={{ fontSize: "0.75rem", color: "#ef4444" }}>No replies yet — system sending now</div>
          )}
        </div>

        {/* B2B Goal */}
        <div style={{ background: "#111", borderRadius: "8px", padding: "16px", border: `1px solid ${b2bDone ? "#22c55e" : "#ef4444"}` }}>
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "8px" }}>B2B WHOLESALE ORDERS</div>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: b2bDone ? "#22c55e" : "#ef4444", marginBottom: "8px" }}>
            {goals.b2b.orders} / {goals.b2b.target}
          </div>
          <GoalBar value={goals.b2b.orders} target={goals.b2b.target} label="Orders" />
          <div style={{ fontSize: "0.75rem", color: "#aaa" }}>Fair.com + wholesale direct</div>
        </div>

        {/* Inderbitzin Goal */}
        <div style={{ background: "#111", borderRadius: "8px", padding: "16px", border: `1px solid ${inderColor}` }}>
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "8px" }}>🎯 INDERBITZIN (PRIORITY CLOSE)</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: inderColor, marginBottom: "8px" }}>
            {goals.inderbitzin.status}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#ccc", marginBottom: "6px" }}>
            First contact: {goals.inderbitzin.lastContactedDate || "unknown"}
            {goals.inderbitzin.followUpSent && " | Follow-up: ✓"}
          </div>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: inderColor, background: "#222", borderRadius: "4px", padding: "6px 8px" }}>
            {goals.inderbitzin.nextAction}
          </div>
        </div>
      </div>

      {goals.error && (
        <div style={{ fontSize: "0.75rem", color: "#888" }}>Goals data: partial (Notion fetch error: {goals.error})</div>
      )}
      {goals.fetchedAt && (
        <div style={{ fontSize: "0.7rem", color: "#555" }}>Refreshed: {goals.fetchedAt} (5-min cache)</div>
      )}
    </section>
  );
}

export default function AgenticCommandCenter() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [actionStates, setActionStates] = useState<Record<string, "idle" | "loading" | "approved" | "denied" | "editing" | "error">>({});
  const [actionMessages, setActionMessages] = useState<Record<string, string>>({});
  // Edit mode — tracks per-item inline editor content (subject + body)
  const [editContent, setEditContent] = useState<Record<string, { subject: string; body: string }>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/agentic/command-center", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Payload;
        if (!alive) return;
        setData(json);
        setError("");
      } catch (err) {
        if (!alive) return;
        setError(String((err as Error).message || err));
      }
    };

    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Approve as-is or kill completely (deny)
  const handleReplyAction = useCallback(async (queueId: string, action: "approve" | "deny") => {
    setActionStates((s) => ({ ...s, [queueId]: "loading" }));
    try {
      const res = await fetch("/api/agentic/reply-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setActionStates((s) => ({ ...s, [queueId]: action === "approve" ? "approved" : "denied" }));
      setActionMessages((s) => ({ ...s, [queueId]: json.message || "Done" }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [queueId]: "error" }));
      setActionMessages((s) => ({ ...s, [queueId]: String((err as Error).message || err) }));
    }
  }, []);

  // Enter edit mode — pre-fill editor with current draft content
  const handleEnterEditMode = useCallback((queueId: string, draftSubject: string, draftBody: string) => {
    setEditContent((s) => ({
      ...s,
      [queueId]: { subject: s[queueId]?.subject ?? draftSubject, body: s[queueId]?.body ?? draftBody },
    }));
    setActionStates((s) => ({ ...s, [queueId]: "editing" }));
  }, []);

  // Send the edited version
  const handleEditAndSend = useCallback(async (queueId: string) => {
    const content = editContent[queueId];
    if (!content?.subject?.trim() || !content?.body?.trim()) return;
    setActionStates((s) => ({ ...s, [queueId]: "loading" }));
    try {
      const res = await fetch("/api/agentic/reply-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId, action: "edit-and-send", editedSubject: content.subject, editedBody: content.body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setActionStates((s) => ({ ...s, [queueId]: "approved" }));
      setActionMessages((s) => ({ ...s, [queueId]: json.message || "Edited version queued for send." }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [queueId]: "editing" }));
      setActionMessages((s) => ({ ...s, [queueId]: `Error: ${String((err as Error).message || err)}` }));
    }
  }, [editContent]);

  const staleCount = useMemo(
    () => (data?.agents || []).filter((agent) => agent.health.stale).length,
    [data]
  );

  return (
    <div className={styles.shell}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>USA Gummies Agentic Command Center</h1>
          <p className={styles.subtitle}>
            Live proof-of-life, schedule compliance, self-heal status, and error visibility.
          </p>
          <p className={styles.subtitle}>
            Build: {COMMAND_CENTER_BUILD} | Origin: {origin || "loading"}
          </p>
          {error ? (
            <p className={`${styles.subtitle} ${styles.statusCritical}`}>Data fetch error: {error}</p>
          ) : null}
          {!data && !error ? (
            <p className={styles.subtitle} style={{ fontWeight: 600 }}>Connecting to agent system...</p>
          ) : null}
        </header>

        {/* WEEK MISSION — funding targets */}
        {data?.weekGoals && <WeekGoalsPanel goals={data.weekGoals} />}

        {/* REPLY ATTENTION QUEUE — always at the top for immediate action */}
        <section className={styles.panel} style={{ border: (data?.attentionQueue?.pendingCount ?? 0) > 0 ? "2px solid #ef4444" : undefined }}>
          <h2 className={styles.panelTitle}>
            ⚡ Reply Attention Queue — Ben&apos;s Authorization Required
            {(data?.attentionQueue?.pendingCount ?? 0) > 0 && (
              <span style={{ marginLeft: "10px", color: "#ef4444", fontWeight: 700 }}>
                {data?.attentionQueue?.pendingCount} PENDING
              </span>
            )}
          </h2>
          <p className={styles.mono}>
            Interested: {data?.attentionQueue?.interestedCount ?? 0} | Other: {data?.attentionQueue?.otherCount ?? 0} | Not Interested: {data?.attentionQueue?.notInterestedCount ?? 0}
            {"\n"}Agent drafts replies here but NEVER sends without your explicit Approve.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Received (ET)</th>
                  <th>Category</th>
                  <th>Sender</th>
                  <th>Account</th>
                  <th>Recommended Action</th>
                  <th>Draft Reply</th>
                  <th>Your Decision</th>
                </tr>
              </thead>
              <tbody>
                {(data?.attentionQueue?.items || []).slice(0, 25).map((item) => {
                  const aState = actionStates[item.queueId] || "idle";
                  const isEditing = aState === "editing";
                  const isPending = item.status === "pending" && aState !== "approved" && aState !== "denied" && !isEditing;
                  const ec = editContent[item.queueId];
                  return (
                    <tr key={item.queueId} style={{ background: item.category === "INTERESTED" ? "#0f1f0f" : isEditing ? "#1a1000" : undefined }}>
                      <td>{item.receivedAtET || item.queuedAtET || "n/a"}</td>
                      <td>
                        <span className={item.category === "INTERESTED" ? `${styles.badge} ${styles.badgeHealthy}` : `${styles.badge} ${styles.badgeWarning}`}>
                          {item.category}
                        </span>
                      </td>
                      <td>{item.senderEmail}</td>
                      <td>{item.prospectType} — {item.prospectName}</td>
                      <td style={{ fontSize: "0.8rem" }}>{item.recommendedAction}</td>
                      <td>
                        {isEditing ? (
                          // Edit mode — show editable subject + body
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "320px" }}>
                            <input
                              type="text"
                              value={ec?.subject ?? item.draftSubject}
                              onChange={(e) => setEditContent((s) => ({ ...s, [item.queueId]: { ...s[item.queueId], subject: e.target.value } }))}
                              style={{
                                background: "#1a1a1a", color: "#fff", border: "1px solid #f59e0b",
                                borderRadius: "4px", padding: "4px 8px", fontSize: "0.8rem", fontWeight: 700, width: "100%",
                              }}
                            />
                            <textarea
                              rows={10}
                              value={ec?.body ?? item.draftBody}
                              onChange={(e) => setEditContent((s) => ({ ...s, [item.queueId]: { ...s[item.queueId], body: e.target.value } }))}
                              style={{
                                background: "#1a1a1a", color: "#e5e7eb", border: "1px solid #f59e0b",
                                borderRadius: "4px", padding: "6px 8px", fontSize: "0.75rem",
                                fontFamily: "monospace", width: "100%", resize: "vertical",
                              }}
                            />
                          </div>
                        ) : (
                          <div className={styles.mono} style={{ fontSize: "0.75rem", maxWidth: "300px", whiteSpace: "pre-wrap" }}>
                            <strong>{item.draftSubject}</strong>
                            {"\n\n"}
                            {item.draftBody}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: "160px", verticalAlign: "top" }}>
                        {isEditing ? (
                          // Edit mode — send edited or kill
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ fontSize: "0.7rem", color: "#f59e0b", fontWeight: 700, marginBottom: "2px" }}>
                              ✎ Edit mode
                            </div>
                            <button
                              onClick={() => handleEditAndSend(item.queueId)}
                              style={{
                                background: "#2563eb", color: "#fff", border: "none", padding: "6px 12px",
                                borderRadius: "4px", cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", width: "100%",
                              }}
                            >
                              ↑ Send Edited
                            </button>
                            <button
                              onClick={() => handleReplyAction(item.queueId, "deny")}
                              style={{
                                background: "#7f1d1d", color: "#fca5a5", border: "1px solid #ef4444",
                                padding: "6px 12px", borderRadius: "4px", cursor: "pointer",
                                fontWeight: 700, fontSize: "0.8rem", width: "100%",
                              }}
                            >
                              ✕ Kill Draft
                            </button>
                            {actionMessages[item.queueId] && (
                              <div style={{ fontSize: "0.7rem", color: "#f87171", marginTop: "2px" }}>
                                {actionMessages[item.queueId]}
                              </div>
                            )}
                          </div>
                        ) : isPending ? (
                          // Normal pending — approve or enter edit mode
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <button
                              disabled={aState === "loading"}
                              onClick={() => handleReplyAction(item.queueId, "approve")}
                              style={{
                                background: aState === "loading" ? "#555" : "#22c55e",
                                color: "#fff", border: "none", padding: "6px 12px",
                                borderRadius: "4px", cursor: aState === "loading" ? "not-allowed" : "pointer",
                                fontWeight: 700, fontSize: "0.8rem", width: "100%",
                              }}
                            >
                              {aState === "loading" ? "Sending..." : "✓ Approve & Send"}
                            </button>
                            <button
                              disabled={aState === "loading"}
                              onClick={() => handleEnterEditMode(item.queueId, item.draftSubject, item.draftBody)}
                              style={{
                                background: aState === "loading" ? "#555" : "#374151",
                                color: "#f59e0b", border: "1px solid #f59e0b", padding: "6px 12px",
                                borderRadius: "4px", cursor: aState === "loading" ? "not-allowed" : "pointer",
                                fontWeight: 700, fontSize: "0.8rem", width: "100%",
                              }}
                            >
                              ✎ Edit / Deny
                            </button>
                          </div>
                        ) : (
                          // Actioned — show final state badge
                          <div>
                            <span className={
                              aState === "approved" ? `${styles.badge} ${styles.badgeHealthy}`
                                : aState === "denied" ? `${styles.badge} ${styles.badgeCritical}`
                                  : aState === "error" ? `${styles.badge} ${styles.badgeCritical}`
                                    : `${styles.badge} ${styles.badgeUnknown}`
                            }>
                              {aState === "approved" ? "APPROVED" : aState === "denied" ? "KILLED" : aState === "error" ? "ERROR" : item.status.toUpperCase()}
                            </span>
                            {actionMessages[item.queueId] && (
                              <div style={{ fontSize: "0.7rem", color: "#aaa", marginTop: "4px", maxWidth: "180px" }}>
                                {actionMessages[item.queueId]}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(data?.attentionQueue?.items || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: "#888" }}>No pending reply attention items. System is watching inbox.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>System Gate</h2>
          <p className={styles.mono}>
            Status:
            {" "}
            <span className={systemBadgeClass(data?.systemStatus?.level || "error")}>
              {data?.systemStatus?.label || "LOADING"}
            </span>
            {"\n"}A system is RUNNING only when critical checks pass. Unknown verification states degrade to DEGRADED.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {(data?.systemStatus?.checks || []).map((check) => (
                  <tr key={check.key}>
                    <td>{check.label}</td>
                    <td>
                      <span className={
                        check.status === "pass"
                          ? `${styles.badge} ${styles.badgeHealthy}`
                          : check.status === "fail"
                            ? `${styles.badge} ${styles.badgeCritical}`
                            : `${styles.badge} ${styles.badgeUnknown}`
                      }>
                        {check.status.toUpperCase()}
                      </span>
                    </td>
                    <td>{check.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Freshness SLA</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Panel</th>
                  <th>State</th>
                  <th>Age (min)</th>
                  <th>SLA (min)</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {(data?.freshness || []).map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td>
                      <span className={freshnessBadgeClass(item.state)}>
                        {item.state.toUpperCase()}
                      </span>
                    </td>
                    <td>{item.ageMinutes ?? "n/a"}</td>
                    <td>{item.staleAfterMinutes}</td>
                    <td>{item.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Operator Control (Personal Oversight)</h2>
          <p className={styles.mono}>
            Owner: {data?.operatorControl?.owner || "n/a"}
            {"\n"}Mode: {data?.operatorControl?.controlMode || "n/a"}
            {"\n"}Status:
            {" "}
            <span className={systemBadgeClass(data?.operatorControl?.level || "error")}>
              {data?.operatorControl?.label || "LOADING"}
            </span>
            {"\n"}Reply policy: {data?.operatorControl?.replyPolicy || "n/a"}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Control Check</th>
                  <th>Pass</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {(data?.operatorControl?.checks || []).map((check) => (
                  <tr key={check.key}>
                    <td>{check.label}</td>
                    <td>
                      <span className={check.ok ? `${styles.badge} ${styles.badgeHealthy}` : `${styles.badge} ${styles.badgeCritical}`}>
                        {check.ok ? "PASS" : "FAIL"}
                      </span>
                    </td>
                    <td>{check.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.mono}>
            Manual runs (24h): {data?.operatorControl?.stats?.manualRuns24h ?? "-"}
            {"\n"}Automated runs (24h): {data?.operatorControl?.stats?.automatedRuns24h ?? "-"}
            {"\n"}Total runs (24h): {data?.operatorControl?.stats?.totalRuns24h ?? "-"}
            {"\n"}Last manual run: {data?.operatorControl?.stats?.lastManualRunAtET || "n/a"} ({data?.operatorControl?.stats?.lastManualAgent || "n/a"})
            {"\n"}Training profile updated: {data?.operatorControl?.stats?.trainingUpdatedAtET || "n/a"}
            {"\n"}Training changes logged: {data?.operatorControl?.stats?.trainingNotesCount ?? "-"}
            {"\n"}Recent training notes:
            {"\n"}{(data?.operatorControl?.stats?.recentTrainingNotes || []).join("\n") || "n/a"}
          </p>
        </section>

        <section className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Overall</div>
            <div className={`${styles.kpiValue} ${textClass(data?.overall || "unknown")}`}>
              {data?.overall || "loading"}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Active Agents</div>
            <div className={`${styles.kpiValue} ${styles.statusWarning}`}>{data?.indicatorCounts.active ?? "-"}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Idle Agents</div>
            <div className={`${styles.kpiValue} ${styles.statusUnknown}`}>{data?.indicatorCounts.idle ?? "-"}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Error Agents</div>
            <div className={`${styles.kpiValue} ${styles.statusCritical}`}>{data?.indicatorCounts.error ?? "-"}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Dashboard Refresh (ET)</div>
            <div className={styles.kpiValue} style={{ fontSize: "1rem" }}>
              {data?.generatedAtET || "loading"}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Stale Agents</div>
            <div className={`${styles.kpiValue} ${staleCount > 0 ? styles.statusCritical : styles.statusHealthy}`}>
              {data ? staleCount : "-"}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Replies Needing Ben</div>
            <div className={`${styles.kpiValue} ${(data?.attentionQueue?.pendingCount || 0) > 0 ? styles.statusCritical : styles.statusHealthy}`}>
              {data?.attentionQueue?.pendingCount ?? "-"}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sales KPI Snapshot</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Today</th>
                  <th>Cumulative</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Leads cultivated</td>
                  <td>{data?.kpis?.todayMetrics?.leadsCultivated ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.leadsCultivated ?? "-"}</td>
                </tr>
                <tr>
                  <td>B2B emails sent</td>
                  <td>{data?.kpis?.todayMetrics?.b2bEmailsSent ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.b2bEmailsSent ?? "-"}</td>
                </tr>
                <tr>
                  <td>Distributor emails sent</td>
                  <td>{data?.kpis?.todayMetrics?.distributorEmailsSent ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.distributorEmailsSent ?? "-"}</td>
                </tr>
                <tr>
                  <td>Follow-up emails sent</td>
                  <td>{data?.kpis?.todayMetrics?.followupEmailsSent ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.followupEmailsSent ?? "-"}</td>
                </tr>
                <tr>
                  <td>Total emails sent</td>
                  <td>{data?.kpis?.todayMetrics?.totalEmailsSent ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.emailsSent ?? "-"}</td>
                </tr>
                <tr>
                  <td>Replies processed (matched CRM)</td>
                  <td>{data?.kpis?.todayMetrics?.repliesProcessed ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.repliesProcessed ?? "-"}</td>
                </tr>
                <tr>
                  <td>Interested replies</td>
                  <td>{data?.kpis?.todayMetrics?.repliesInterested ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.repliesInterested ?? "-"}</td>
                </tr>
                <tr>
                  <td>Not interested replies</td>
                  <td>{data?.kpis?.todayMetrics?.repliesNotInterested ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.repliesNotInterested ?? "-"}</td>
                </tr>
                <tr>
                  <td>Bounced replies</td>
                  <td>{data?.kpis?.todayMetrics?.repliesBounced ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.repliesBounced ?? "-"}</td>
                </tr>
                <tr>
                  <td>Inbox messages scanned</td>
                  <td>{data?.kpis?.todayMetrics?.inboxScanned ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.inboxScanned ?? "-"}</td>
                </tr>
                <tr>
                  <td>Inbox unmatched (no CRM match)</td>
                  <td>{data?.kpis?.todayMetrics?.inboxUnmatched ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.inboxUnmatched ?? "-"}</td>
                </tr>
                <tr>
                  <td>Unmatched bounce notices</td>
                  <td>{data?.kpis?.todayMetrics?.inboxUnmatchedBounces ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.inboxUnmatchedBounces ?? "-"}</td>
                </tr>
                <tr>
                  <td>Failed deliveries (send errors)</td>
                  <td>{data?.kpis?.todayMetrics?.failedDeliveries ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.failedDeliveries ?? "-"}</td>
                </tr>
                <tr>
                  <td>Fair orders logged</td>
                  <td>{data?.kpis?.todayMetrics?.fairOrdersLogged ?? "-"}</td>
                  <td>{data?.kpis?.cumulativeMetrics?.fairOrdersLogged ?? "-"}</td>
                </tr>
                <tr>
                  <td>Quota floor compliance</td>
                  <td>
                    <span className={data?.kpis?.todayMetrics?.floorMet ? `${styles.badge} ${styles.badgeHealthy}` : `${styles.badge} ${styles.badgeCritical}`}>
                      {data?.kpis?.todayMetrics?.floorMet ? "MET" : "SHORTFALL"}
                    </span>
                    <div className={styles.mono}>
                      B2B floor {data?.kpis?.todayMetrics?.b2bSendFloor ?? "-"} shortfall {data?.kpis?.todayMetrics?.b2bFloorShortfall ?? "-"}
                      {"\n"}Distributor floor {data?.kpis?.todayMetrics?.distributorSendFloor ?? "-"} shortfall {data?.kpis?.todayMetrics?.distributorFloorShortfall ?? "-"}
                    </div>
                  </td>
                  <td>n/a</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Proof Of Life</h2>
          <p className={styles.mono}>
            Last heartbeat: {data?.proofOfLife.heartbeatAt || "n/a"}
            {"\n"}Heartbeat source: {data?.proofOfLife.heartbeatSource || "n/a"}
            {"\n"}Self-heal last run: {data?.proofOfLife.selfHealLastRunAt || "n/a"}
            {"\n"}Self-heal summary: {data?.proofOfLife.selfHealSummary || "n/a"}
            {"\n"}Dashboard listener pid: {String(data?.commandCenter.listenerPid ?? "n/a")}
            {"\n"}Dashboard healthy: {data?.commandCenter.healthy ? "yes" : "no"}
            {"\n"}Watchdog last log update: {data?.commandCenter.watchdogLogUpdatedAt || "n/a"}
            {"\n"}Status file: {data?.paths.statusFile || "n/a"}
            {"\n"}Log file: {data?.paths.logFile || "n/a"}
            {"\n"}Dashboard pid file: {data?.paths.commandCenterPidFile || "n/a"}
            {"\n"}Dashboard log file: {data?.paths.commandCenterLogFile || "n/a"}
          </p>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Agent Status Board</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Agent (Labeled)</th>
                  <th>Indicator</th>
                  <th>Last Run Source</th>
                  <th>Schedule</th>
                  <th>Last Run (ET)</th>
                  <th>Next Run (ET)</th>
                  <th>Last Result</th>
                  <th>Error / Reason</th>
                </tr>
              </thead>
              <tbody>
                {(data?.agents || []).map((agent) => (
                  <tr key={agent.key}>
                    <td>{agent.key} — {agent.label}</td>
                    <td>
                      <span className={indicatorBadgeClass(agent.indicator.level)}>
                        {agent.indicator.label}
                      </span>
                      <div className={styles.mono}>{agent.indicator.reason}</div>
                    </td>
                    <td>{agent.state?.source || "n/a"}</td>
                    <td>{formatSchedule(agent)}</td>
                    <td>{agent.state?.lastRunAtET || "n/a"}</td>
                    <td>{agent.nextRunAtET || "n/a"}</td>
                    <td>
                      <span className={badgeClass(agent.health.level)}>{agent.state?.lastStatus || "never"}</span>
                      <div className={styles.mono}>
                        {agent.state?.summary || "No summary"}
                        {typeof agent.state?.lastDurationMs === "number"
                          ? ` | ${Math.round(agent.state.lastDurationMs / 1000)}s`
                          : ""}
                      </div>
                    </td>
                    <td className={styles.statusCritical}>{agent.state?.lastError || agent.health.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className={styles.row}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Recent Events</h2>
            <div className={styles.logBox}>
              <pre className={styles.mono}>
                {(data?.recentEvents || [])
                  .map((event) => `${event.at} | ${event.agent} | ${event.status} | ${event.summary}`)
                  .join("\n") || "No recent events"}
              </pre>
            </div>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Self-Heal Actions</h2>
            <div className={styles.logBox}>
              <pre className={styles.mono}>
                {(data?.selfHeal?.actions || []).join("\n") || "No self-heal actions recorded"}
              </pre>
            </div>
          </section>
        </div>

        <div className={styles.row}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Scheduler Evidence</h2>
            <div className={styles.logBox}>
              <pre className={styles.mono}>
                {data?.cron.installed
                  ? data.cron.lines.join("\n")
                  : data?.cron?.unknown
                    ? "Cloud runtime: scheduler is managed outside local cron block"
                    : "USA_GUMMIES_AGENTIC cron block not found"}
              </pre>
            </div>
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Runtime Log Tail</h2>
            <div className={styles.logBox}>
              <pre className={styles.mono}>{(data?.logs || []).join("\n") || "No log output yet"}</pre>
            </div>
          </section>
        </div>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Dashboard Watchdog</h2>
          <div className={styles.logBox}>
            <pre className={styles.mono}>
              Listener pid: {String(data?.commandCenter.listenerPid ?? "n/a")}
              {"\n"}Listener command: {data?.commandCenter.listenerCommand || "n/a"}
              {"\n"}Tracked pid (pid file): {String(data?.commandCenter.trackedPid ?? "n/a")}
              {"\n"}Tracked pid alive: {data?.commandCenter.trackedPidAlive ? "yes" : "no"}
              {"\n"}Tracked command: {data?.commandCenter.trackedPidCommand || "n/a"}
            </pre>
          </div>
          <div className={styles.logBox}>
            <pre className={styles.mono}>
              {(data?.commandCenter.recentWatchdogLogs || []).join("\n") ||
                "No watchdog logs yet"}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
