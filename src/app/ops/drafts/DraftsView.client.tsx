"use client";

import { useCallback, useEffect, useState } from "react";

type DraftEmail = {
  id: string;
  status: string;
  to: string;
  subject: string;
  body: string;
  noteForBen: string | null;
  sourceEmailId: string | null;
  confidence: string | null;
  riskLevel: string | null;
  summary: string;
  requestedAt: string;
};

type DraftsData = {
  pending: DraftEmail[];
  resolved: DraftEmail[];
  totalPending: number;
  generatedAt: string;
};

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  pending:  { bg: "rgba(199,160,98,0.15)", fg: "#c7a062", label: "PENDING REVIEW" },
  approved: { bg: "rgba(34,197,94,0.15)", fg: "#4ade80", label: "APPROVED" },
  denied:   { bg: "rgba(220,38,38,0.15)", fg: "#ef4444", label: "DENIED" },
};

export function DraftsView() {
  const [data, setData] = useState<DraftsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [denyingId, setDenyingId] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/drafts");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load drafts");
      setData(json as DraftsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  const handleDecision = useCallback(
    async (approvalId: string, decision: "approved" | "denied", reasoning?: string) => {
      setProcessingId(approvalId);
      try {
        const res = await fetch("/api/ops/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId,
            decision,
            reasoning: reasoning || (decision === "approved" ? "Approved email draft for sending" : ""),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Decision failed");

        setActionMsg(
          decision === "approved"
            ? "Draft approved — email will be sent."
            : "Draft denied — email will not be sent.",
        );
        setTimeout(() => setActionMsg(null), 3500);
        setDenyingId(null);
        setDenyReason("");
        void fetchDrafts();
      } catch (err) {
        setActionMsg(err instanceof Error ? err.message : "Action failed");
        setTimeout(() => setActionMsg(null), 3500);
      } finally {
        setProcessingId(null);
      }
    },
    [fetchDrafts],
  );

  const pending = data?.pending || [];
  const resolved = data?.resolved || [];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
            Draft Emails
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", margin: 0 }}>
            Review and approve email drafts before Abra sends them.
          </p>
        </div>
        <button
          onClick={fetchDrafts}
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

      {/* Toast */}
      {actionMsg && (
        <div
          style={{
            background: actionMsg.includes("approved")
              ? "rgba(34,197,94,0.12)"
              : actionMsg.includes("denied")
                ? "rgba(220,38,38,0.12)"
                : "rgba(199,160,98,0.12)",
            border: `1px solid ${
              actionMsg.includes("approved")
                ? "rgba(34,197,94,0.3)"
                : actionMsg.includes("denied")
                  ? "rgba(220,38,38,0.3)"
                  : "rgba(199,160,98,0.3)"
            }`,
            borderRadius: 8,
            padding: "10px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: "rgba(255,255,255,0.9)",
          }}
        >
          {actionMsg}
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 130px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Pending Review</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#c7a062" }}>{pending.length}</div>
        </div>
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 130px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Sent</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#4ade80" }}>{resolved.filter((d) => d.status === "approved").length}</div>
        </div>
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 20px", flex: "1 1 130px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Rejected</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#ef4444" }}>{resolved.filter((d) => d.status === "denied").length}</div>
        </div>
      </div>

      {/* Pending Drafts */}
      {loading && pending.length === 0 && (
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px", color: "rgba(255,255,255,0.35)", fontSize: 13, textAlign: "center" }}>
          Loading drafts...
        </div>
      )}

      {!loading && pending.length === 0 && (
        <div style={{ background: "#1a1d27", border: "1px solid rgba(199,160,98,0.15)", borderRadius: 12, padding: "28px", color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center" }}>
          No pending email drafts. Abra will create drafts when action-required emails arrive.
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {pending.map((draft) => {
          const isExpanded = expandedId === draft.id;
          const isProcessing = processingId === draft.id;
          const isDenying = denyingId === draft.id;
          const status = STATUS_STYLES[draft.status] || STATUS_STYLES.pending;

          return (
            <article
              key={draft.id}
              style={{
                background: "#1a1d27",
                border: "1px solid rgba(199,160,98,0.35)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {/* Header row */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                style={{
                  padding: "14px 16px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: status.bg, color: status.fg, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700 }}>
                    {status.label}
                  </span>
                  <strong style={{ fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                    To: {draft.to}
                  </strong>
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                  {new Date(draft.requestedAt).toLocaleString()}
                </span>
              </div>

              {/* Subject */}
              <div style={{ padding: "0 16px 8px", fontSize: 14, color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
                {draft.subject}
              </div>

              {/* Summary */}
              <div style={{ padding: "0 16px 12px", fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                {draft.summary}
              </div>

              {/* Note for Ben */}
              {draft.noteForBen && (
                <div style={{ margin: "0 16px 12px", padding: "8px 12px", background: "rgba(199,160,98,0.08)", border: "1px solid rgba(199,160,98,0.2)", borderRadius: 8, fontSize: 12, color: "#c7a062", lineHeight: 1.4 }}>
                  <strong style={{ marginRight: 6 }}>Note for Ben:</strong>
                  {draft.noteForBen}
                </div>
              )}

              {/* Expanded: full email body */}
              {isExpanded && (
                <div style={{ padding: "0 16px 16px" }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
                    Full Draft
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      padding: "12px 16px",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.8)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                    }}
                  >
                    {draft.body}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDecision(draft.id, "approved");
                      }}
                      disabled={isProcessing}
                      style={{
                        background: "rgba(34,197,94,0.15)",
                        border: "1px solid rgba(34,197,94,0.4)",
                        color: "#4ade80",
                        borderRadius: 8,
                        padding: "8px 16px",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: isProcessing ? "wait" : "pointer",
                        fontFamily: "inherit",
                        opacity: isProcessing ? 0.5 : 1,
                      }}
                    >
                      {isProcessing ? "Sending..." : "Approve & Send"}
                    </button>

                    {!isDenying ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDenyingId(draft.id);
                        }}
                        disabled={isProcessing}
                        style={{
                          background: "rgba(220,38,38,0.1)",
                          border: "1px solid rgba(220,38,38,0.3)",
                          color: "#ef4444",
                          borderRadius: 8,
                          padding: "8px 16px",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: isProcessing ? "wait" : "pointer",
                          fontFamily: "inherit",
                          opacity: isProcessing ? 0.5 : 1,
                        }}
                      >
                        Reject
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                        <input
                          type="text"
                          value={denyReason}
                          onChange={(e) => setDenyReason(e.target.value)}
                          placeholder="Reason for rejection..."
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex: 1,
                            background: "#0f1628",
                            border: "1px solid rgba(220,38,38,0.3)",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 12,
                            color: "#fff",
                            fontFamily: "inherit",
                            minWidth: 150,
                          }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (denyReason.trim()) {
                              void handleDecision(draft.id, "denied", denyReason.trim());
                            }
                          }}
                          disabled={isProcessing || !denyReason.trim()}
                          style={{
                            background: "rgba(220,38,38,0.15)",
                            border: "1px solid rgba(220,38,38,0.4)",
                            color: "#ef4444",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: isProcessing || !denyReason.trim() ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            opacity: isProcessing || !denyReason.trim() ? 0.5 : 1,
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDenyingId(null);
                            setDenyReason("");
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "rgba(255,255,255,0.5)",
                            cursor: "pointer",
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Click to expand hint */}
              {!isExpanded && (
                <div style={{ padding: "0 16px 12px", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  Click to expand and review full draft
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Resolved section */}
      {resolved.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <button
            onClick={() => setShowResolved(!showResolved)}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "4px 0",
              marginBottom: 12,
            }}
          >
            {showResolved ? "Hide" : "Show"} resolved drafts ({resolved.length})
          </button>

          {showResolved && (
            <div style={{ display: "grid", gap: 10 }}>
              {resolved.map((draft) => {
                const status = STATUS_STYLES[draft.status] || { bg: "rgba(107,114,128,0.12)", fg: "#6b7280", label: draft.status.toUpperCase() };

                return (
                  <article
                    key={draft.id}
                    style={{
                      background: "#1a1d27",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 12,
                      padding: "14px 16px",
                      opacity: 0.7,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: status.bg, color: status.fg, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700 }}>
                          {status.label}
                        </span>
                        <strong style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                          To: {draft.to}
                        </strong>
                      </div>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                        {new Date(draft.requestedAt).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                      {draft.subject}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
