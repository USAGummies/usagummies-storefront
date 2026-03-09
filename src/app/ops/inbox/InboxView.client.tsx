"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useInboxData } from "@/lib/ops/use-war-room-data";

const SOURCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "b2b", label: "B2B" },
  { value: "shopify", label: "Shopify" },
  { value: "amazon", label: "Amazon" },
] as const;

function categoryStyle(cat: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    support: { bg: "rgba(59,130,246,0.12)", fg: "#93c5fd" },
    sales: { bg: "rgba(34,197,94,0.12)", fg: "#4ade80" },
    operations: { bg: "rgba(245,158,11,0.12)", fg: "#fbbf24" },
    finance: { bg: "rgba(236,72,153,0.12)", fg: "#f9a8d4" },
    other: { bg: "rgba(107,114,128,0.12)", fg: "#9ca3af" },
  };
  return colors[cat] || colors.other;
}

// ── Urgency badge styles ──

const URGENCY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  Critical:         { bg: "rgba(220,38,38,0.2)",  fg: "#ef4444", label: "CRITICAL" },
  "Action Required": { bg: "rgba(199,160,98,0.2)", fg: "#c7a062", label: "ACTION" },
  FYI:              { bg: "rgba(27,42,74,0.3)",    fg: "#93c5fd", label: "FYI" },
  Low:              { bg: "rgba(107,114,128,0.12)", fg: "#6b7280", label: "LOW" },
};

const URGENCY_ORDER: Record<string, number> = {
  Critical: 0,
  "Action Required": 1,
  FYI: 2,
  Low: 3,
};

type TriageResult = {
  id: string;
  urgency: string;
  category: string;
  summary: string;
};

export function InboxView() {
  const [source, setSource] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(50);

  // ── AI Triage state ──
  const [triageEnabled, setTriageEnabled] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [triageResults, setTriageResults] = useState<TriageResult[]>([]);
  const [triageError, setTriageError] = useState<string | null>(null);

  const { data, loading, error, refresh } = useInboxData(source, limit, unreadOnly);

  useEffect(() => {
    setLimit(50);
  }, [source, unreadOnly]);

  // Clear triage when source/filter changes
  useEffect(() => {
    setTriageResults([]);
    setTriageError(null);
  }, [source, unreadOnly]);

  // ── Triage handler ──
  const runTriage = useCallback(async () => {
    const messages = data?.messages;
    if (!messages || messages.length === 0) return;

    setTriaging(true);
    setTriageError(null);

    try {
      const payload = messages.slice(0, 20).map((m) => ({
        id: m.id,
        subject: m.subject || "(No subject)",
        sender: m.from,
        snippet: m.snippet,
      }));

      const res = await fetch("/api/ops/inbox/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Triage request failed",
        );
      }

      setTriageResults(Array.isArray(json?.triaged) ? json.triaged : []);
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setTriaging(false);
    }
  }, [data?.messages]);

  // Auto-triage when enabled and data loads
  useEffect(() => {
    if (triageEnabled && data?.messages && data.messages.length > 0 && triageResults.length === 0 && !triaging) {
      void runTriage();
    }
  }, [triageEnabled, data?.messages, triageResults.length, triaging, runTriage]);

  // ── Build triage lookup ──
  const triageMap = useMemo(() => {
    const map = new Map<string, TriageResult>();
    for (const t of triageResults) {
      map.set(t.id, t);
    }
    return map;
  }, [triageResults]);

  // ── Sort messages (by urgency if triage active, else by date) ──
  const sortedMessages = useMemo(() => {
    const msgs = [...(data?.messages || [])];
    if (triageEnabled && triageResults.length > 0) {
      msgs.sort((a, b) => {
        const aUrgency = triageMap.get(a.id)?.urgency || "Low";
        const bUrgency = triageMap.get(b.id)?.urgency || "Low";
        const aOrder = URGENCY_ORDER[aUrgency] ?? 4;
        const bOrder = URGENCY_ORDER[bUrgency] ?? 4;
        return aOrder - bOrder;
      });
    }
    return msgs;
  }, [data?.messages, triageEnabled, triageResults, triageMap]);

  const stats = useMemo(
    () => [
      { label: "Unread Total", value: data?.unreadCount.total || 0, color: "#fbbf24" },
      { label: "Email", value: data?.unreadCount.email || 0, color: "#93c5fd" },
      { label: "Slack", value: data?.unreadCount.slack || 0, color: "#4ade80" },
      { label: "B2B", value: data?.unreadCount.b2b || 0, color: "#f9a8d4" },
    ],
    [data],
  );

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
            Unified Inbox
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", margin: 0 }}>
            Consolidated messages across email, Slack, B2B, Shopify, and Amazon.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              const next = !triageEnabled;
              setTriageEnabled(next);
              if (!next) {
                setTriageResults([]);
                setTriageError(null);
              }
            }}
            disabled={triaging || loading}
            style={{
              border: triageEnabled
                ? "1px solid rgba(199,160,98,0.5)"
                : "1px solid rgba(255,255,255,0.12)",
              background: triageEnabled
                ? "rgba(199,160,98,0.12)"
                : "rgba(255,255,255,0.04)",
              color: triageEnabled ? "#c7a062" : "rgba(255,255,255,0.85)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              cursor: triaging || loading ? "wait" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {triaging ? (
              <>
                <span style={{ display: "inline-block", animation: "pulse 1.2s ease-in-out infinite" }}>🧠</span>
                Triaging...
              </>
            ) : (
              <>🧠 AI Triage {triageEnabled ? "ON" : "OFF"}</>
            )}
          </button>
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
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
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
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>

        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
          {data?.lastUpdated ? `Updated ${new Date(data.lastUpdated).toLocaleTimeString()}` : ""}
        </span>

        {triageEnabled && triageResults.length > 0 && (
          <span style={{ color: "#c7a062", fontSize: 11, fontWeight: 600 }}>
            🧠 {triageResults.length} messages triaged
          </span>
        )}
      </div>

      {error ? (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {triageError ? (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#ef4444", fontSize: 13 }}>
          🧠 Triage error: {triageError}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 130px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {loading ? (
          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px", color: "rgba(255,255,255,0.35)", fontSize: 13, textAlign: "center" }}>
            Loading inbox messages...
          </div>
        ) : null}

        {!loading && (data?.messages.length || 0) === 0 ? (
          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "28px", color: "rgba(255,255,255,0.35)", fontSize: 13, textAlign: "center" }}>
            No messages for the selected filter.
          </div>
        ) : null}

        {sortedMessages.map((msg) => {
          const category = categoryStyle(msg.category);
          const triage = triageMap.get(msg.id);
          const urgencyStyle = triage ? URGENCY_STYLES[triage.urgency] : null;

          return (
            <article
              key={msg.id}
              style={{
                background: "#1a1d27",
                border: `1px solid ${
                  triage && triage.urgency === "Critical"
                    ? "rgba(220,38,38,0.4)"
                    : triage && triage.urgency === "Action Required"
                      ? "rgba(199,160,98,0.35)"
                      : msg.read
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(251,191,36,0.35)"
                }`,
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13, color: "rgba(255,255,255,0.92)" }}>{msg.from}</strong>
                  <span style={{ fontSize: 10, textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em", fontWeight: 700 }}>
                    {msg.source}
                  </span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: category.bg, color: category.fg, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700 }}>
                    {msg.category}
                  </span>
                  {urgencyStyle && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: urgencyStyle.bg,
                        color: urgencyStyle.fg,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      🧠 {urgencyStyle.label}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                  {new Date(msg.date).toLocaleString()}
                </span>
              </div>

              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", marginBottom: 5 }}>
                {msg.subject || "(No subject)"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{msg.snippet}</div>

              {triage && triage.summary && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    background: "rgba(199,160,98,0.06)",
                    border: "1px solid rgba(199,160,98,0.15)",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "rgba(255,255,255,0.7)",
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: "#c7a062", fontWeight: 700, marginRight: 6 }}>🧠</span>
                  {triage.summary}
                </div>
              )}
            </article>
          );
        })}
        {!loading && (data?.messages.length || 0) >= limit ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
            <button
              onClick={() => setLimit((prev) => prev + 50)}
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.85)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Load more
            </button>
          </div>
        ) : null}
      </div>

      {/* Pulse animation for triage loading */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
