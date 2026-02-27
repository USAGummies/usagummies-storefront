"use client";

import { useMemo, useState } from "react";
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

export function InboxView() {
  const [source, setSource] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, loading, error, refresh } = useInboxData(source, 50, unreadOnly);

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
      </div>

      {error ? (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
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

        {(data?.messages || []).map((msg) => {
          const category = categoryStyle(msg.category);
          return (
            <article
              key={msg.id}
              style={{
                background: "#1a1d27",
                border: `1px solid ${msg.read ? "rgba(255,255,255,0.06)" : "rgba(251,191,36,0.35)"}`,
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <strong style={{ fontSize: 13, color: "rgba(255,255,255,0.92)" }}>{msg.from}</strong>
                  <span style={{ fontSize: 10, textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em", fontWeight: 700 }}>
                    {msg.source}
                  </span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: category.bg, color: category.fg, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700 }}>
                    {msg.category}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                  {new Date(msg.date).toLocaleString()}
                </span>
              </div>

              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", marginBottom: 5 }}>
                {msg.subject || "(No subject)"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{msg.snippet}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
