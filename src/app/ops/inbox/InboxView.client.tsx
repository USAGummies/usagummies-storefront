"use client";

import { useEffect, useState } from "react";

type ReplyItem = {
  id?: string;
  from?: string;
  fromEmail?: string;
  subject?: string;
  snippet?: string;
  receivedAt?: string;
  suggestedReply?: string;
  status?: string; // pending, approved, denied, sent
  prospectName?: string;
  prospectCompany?: string;
  category?: string; // interested, question, rejection, other
};

type InboxData = {
  queue: ReplyItem[];
  approved: ReplyItem[];
  stats: { pending: number; approved: number; denied: number; sent: number };
};

function CategoryBadge({ cat }: { cat?: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    interested: { bg: "rgba(34,197,94,0.12)", fg: "#4ade80" },
    question: { bg: "rgba(59,130,246,0.12)", fg: "#60a5fa" },
    rejection: { bg: "rgba(239,68,68,0.12)", fg: "#f87171" },
    other: { bg: "rgba(107,114,128,0.12)", fg: "#9ca3af" },
  };
  const c = colors[cat || "other"] || colors.other;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", padding: "2px 8px", borderRadius: 6, background: c.bg, color: c.fg }}>
      {cat || "other"}
    </span>
  );
}

export function InboxView() {
  const [data, setData] = useState<InboxData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function loadQueue() {
    try {
      setLoading(true);
      const res = await fetch("/api/agentic/reply-action", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
    } catch {
      setError("Failed to load reply queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleAction(id: string, action: "approve" | "deny") {
    setActionLoading(id);
    try {
      const res = await fetch("/api/agentic/reply-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await loadQueue();
    } catch {
      setError(`Failed to ${action} reply`);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
          Reply Queue
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          Approve, deny, or edit outgoing B2B emails before they send.
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {data && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
          {[
            { label: "Pending", value: data.stats.pending, color: "#fbbf24" },
            { label: "Approved", value: data.stats.approved, color: "#4ade80" },
            { label: "Denied", value: data.stats.denied, color: "#f87171" },
            { label: "Sent", value: data.stats.sent, color: "#60a5fa" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 120px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "40px 0" }}>Loading reply queue...</div>
      )}

      {data && data.queue.length === 0 && !loading && (
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "40px 32px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
          No pending replies — queue is clear.
        </div>
      )}

      {data && data.queue.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.queue.map((item, i) => (
            <div
              key={item.id || i}
              style={{
                background: "#1a1d27",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "18px 22px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
                      {item.prospectName || item.from || "Unknown"}
                    </span>
                    <CategoryBadge cat={item.category} />
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                    {item.prospectCompany ? `${item.prospectCompany} · ` : ""}
                    {item.fromEmail || ""} · {item.receivedAt ? new Date(item.receivedAt).toLocaleDateString() : ""}
                  </div>
                </div>
              </div>

              {item.subject && (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
                  <strong>Subject:</strong> {item.subject}
                </div>
              )}
              {item.snippet && (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12, lineHeight: 1.5, maxHeight: 60, overflow: "hidden" }}>
                  {item.snippet}
                </div>
              )}
              {item.suggestedReply && (
                <div style={{ background: "rgba(99,102,241,0.06)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>Suggested Reply</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, maxHeight: 80, overflow: "hidden" }}>
                    {item.suggestedReply}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => item.id && handleAction(item.id, "approve")}
                  disabled={actionLoading === item.id}
                  style={{
                    padding: "8px 18px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "rgba(34,197,94,0.15)",
                    color: "#4ade80",
                    border: "1px solid rgba(34,197,94,0.2)",
                    borderRadius: 8,
                    cursor: actionLoading === item.id ? "wait" : "pointer",
                    fontFamily: "inherit",
                    opacity: actionLoading === item.id ? 0.5 : 1,
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => item.id && handleAction(item.id, "deny")}
                  disabled={actionLoading === item.id}
                  style={{
                    padding: "8px 18px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "rgba(239,68,68,0.1)",
                    color: "#f87171",
                    border: "1px solid rgba(239,68,68,0.15)",
                    borderRadius: 8,
                    cursor: actionLoading === item.id ? "wait" : "pointer",
                    fontFamily: "inherit",
                    opacity: actionLoading === item.id ? 0.5 : 1,
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
