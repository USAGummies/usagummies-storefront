"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { usePermissionsData, type PermissionApproval } from "@/lib/ops/use-permissions-data";

const CARD_STYLE: CSSProperties = {
  background: "#1a1d27",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "14px 16px",
};

function confidenceColor(value: PermissionApproval["confidence"]): string {
  if (value === "high") return "#22c55e";
  if (value === "medium") return "#f59e0b";
  if (value === "low") return "#ef4444";
  return "#6b7280";
}

function riskColor(value: PermissionApproval["risk_level"]): string {
  if (value === "critical") return "#ef4444";
  if (value === "high") return "#f97316";
  if (value === "medium") return "#f59e0b";
  if (value === "low") return "#22c55e";
  return "#6b7280";
}

function tryFormatSupport(data: string | null): string {
  if (!data) return "No supporting data.";
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return data;
  }
}

export function PermissionsView() {
  const { data, loading, error, refresh, processApproval } = usePermissionsData();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [batchReason, setBatchReason] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const approvals = data?.approvals || [];

  const selectedList = useMemo(
    () => approvals.filter((a) => selectedIds[a.id]),
    [approvals, selectedIds],
  );

  async function runAction(
    approval: PermissionApproval,
    decision: "approved" | "denied",
    reasoning?: string,
  ) {
    try {
      setErrorBanner(null);
      setBusyIds((prev) => ({ ...prev, [approval.id]: true }));
      await processApproval({
        approvalId: approval.id,
        decision,
        reasoning,
      });
      setBanner(`${decision === "approved" ? "Approved" : "Denied"} ${approval.agent_name} request.`);
      setSelectedIds((prev) => {
        const next = { ...prev };
        delete next[approval.id];
        return next;
      });
      if (expandedId === approval.id) setExpandedId(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to process approval");
    } finally {
      setBusyIds((prev) => ({ ...prev, [approval.id]: false }));
    }
  }

  async function runBatch(decision: "approved" | "denied") {
    if (selectedList.length === 0) return;
    if (decision === "denied" && !batchReason.trim()) {
      setErrorBanner("Batch deny requires reasoning.");
      return;
    }

    setErrorBanner(null);
    const outcomes = await Promise.allSettled(
      selectedList.map((a) =>
        processApproval({
          approvalId: a.id,
          decision,
          reasoning: decision === "denied" ? batchReason : undefined,
        }),
      ),
    );

    const ok = outcomes.filter((o) => o.status === "fulfilled").length;
    const failed = outcomes.length - ok;

    if (failed > 0) {
      setErrorBanner(`${failed} request(s) failed in batch. Review cards and retry failed items.`);
    } else {
      setBanner(`${ok} request(s) ${decision === "approved" ? "approved" : "denied"}.`);
    }

    setSelectedIds({});
    setBatchReason("");
    await refresh();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, marginBottom: 8, fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)" }}>
            Permission Queue
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            Human decision layer. Pending requests from agents requiring explicit approval.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.9)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ ...CARD_STYLE, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
          <strong>{data?.totalPending || 0}</strong> pending decision{(data?.totalPending || 0) === 1 ? "" : "s"}
          {data?.generatedAt ? ` • updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
          <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
          Batch mode
        </label>
      </div>

      {banner ? (
        <div style={{ ...CARD_STYLE, borderColor: "rgba(34,197,94,0.4)", color: "#86efac", fontSize: 13 }}>{banner}</div>
      ) : null}
      {errorBanner || error ? (
        <div style={{ ...CARD_STYLE, borderColor: "rgba(239,68,68,0.35)", color: "#fca5a5", fontSize: 13 }}>
          {errorBanner || error}
        </div>
      ) : null}

      {batchMode && selectedList.length > 0 ? (
        <div style={{ ...CARD_STYLE, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
            {selectedList.length} selected for batch action.
          </div>
          <textarea
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            rows={3}
            placeholder="Required for batch deny."
            style={{
              width: "100%",
              resize: "vertical",
              background: "#0f121b",
              color: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: 10,
              fontFamily: "inherit",
              fontSize: 12,
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => void runBatch("approved")}
              style={{ border: 0, borderRadius: 8, background: "#166534", color: "white", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}
            >
              Approve selected
            </button>
            <button
              onClick={() => void runBatch("denied")}
              style={{ border: 0, borderRadius: 8, background: "#991b1b", color: "white", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}
            >
              Deny selected
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ ...CARD_STYLE, color: "rgba(255,255,255,0.5)", textAlign: "center", padding: "24px 16px" }}>
          Loading pending approvals...
        </div>
      ) : null}

      {!loading && approvals.length === 0 ? (
        <div style={{ ...CARD_STYLE, color: "#86efac", textAlign: "center", padding: "24px 16px" }}>
          No decisions pending. All clear.
        </div>
      ) : null}

      {!loading
        ? approvals.map((approval) => {
            const expanded = expandedId === approval.id;
            const busy = Boolean(busyIds[approval.id]);
            const denyReason = reasonById[approval.id] || "";
            const tier = approval.permission_tier ?? 0;
            const confColor = confidenceColor(approval.confidence);
            const risk = riskColor(approval.risk_level);

            return (
              <article key={approval.id} style={CARD_STYLE}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    {batchMode ? (
                      <input
                        type="checkbox"
                        checked={Boolean(selectedIds[approval.id])}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [approval.id]: e.target.checked,
                          }))
                        }
                      />
                    ) : null}
                    {approval.agent_name === "abra" || approval.approval_trigger === "abra_proposal" ? (
                      <span style={{ background: "rgba(199,160,98,0.2)", color: "#c7a062", padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>🧠 ABRA</span>
                    ) : null}
                    <span style={{ color: "rgba(255,255,255,0.92)", fontWeight: 700, fontSize: 13 }}>{approval.agent_name}</span>
                    <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                      {approval.agent_department || "unknown dept"}
                    </span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                    {new Date(approval.requested_at).toLocaleString()}
                  </span>
                </div>

                <div style={{ color: "rgba(255,255,255,0.92)", fontSize: 14, marginBottom: 8 }}>{approval.summary}</div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <span style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.76)", padding: "2px 8px", borderRadius: 999, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {approval.action_type}
                  </span>
                  <span style={{ background: `${confColor}20`, color: confColor, padding: "2px 8px", borderRadius: 999, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    confidence {approval.confidence || "n/a"}
                  </span>
                  <span style={{ background: `${risk}20`, color: risk, padding: "2px 8px", borderRadius: 999, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    risk {approval.risk_level || "n/a"}
                  </span>
                  <span style={{ background: "rgba(251,191,36,0.18)", color: "#fcd34d", padding: "2px 8px", borderRadius: 999, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    tier {tier}
                  </span>
                </div>

                {/* Confidence progress bar + risk indicator */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1, maxWidth: 180 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3, letterSpacing: "0.04em" }}>CONFIDENCE</div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 3,
                          background: confColor,
                          width: `${approval.confidence === "high" ? 90 : approval.confidence === "medium" ? 55 : approval.confidence === "low" ? 25 : 0}%`,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1, maxWidth: 180 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3, letterSpacing: "0.04em" }}>RISK LEVEL</div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {(["low", "medium", "high", "critical"] as const).map((level) => (
                        <div
                          key={level}
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background:
                              (approval.risk_level === "critical") ||
                              (approval.risk_level === "high" && level !== "critical") ||
                              (approval.risk_level === "medium" && (level === "low" || level === "medium")) ||
                              (approval.risk_level === "low" && level === "low")
                                ? risk
                                : "rgba(255,255,255,0.06)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: expanded ? 10 : 0 }}>
                  <button
                    onClick={() => void runAction(approval, "approved")}
                    disabled={busy}
                    style={{ border: 0, borderRadius: 8, background: "#166534", color: "white", padding: "8px 12px", fontSize: 12, cursor: busy ? "wait" : "pointer" }}
                  >
                    {busy ? "Processing..." : "Approve"}
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : approval.id)}
                    disabled={busy}
                    style={{ border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, background: "transparent", color: "rgba(255,255,255,0.9)", padding: "8px 12px", fontSize: 12, cursor: busy ? "wait" : "pointer" }}
                  >
                    {expanded ? "Hide details" : "Review + deny"}
                  </button>
                </div>

                {expanded ? (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        fontSize: 11,
                        color: "rgba(255,255,255,0.72)",
                        background: "#0f121b",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 8,
                        padding: 10,
                        maxHeight: 180,
                        overflow: "auto",
                      }}
                    >
                      {tryFormatSupport(approval.supporting_data)}
                    </pre>
                    <textarea
                      value={denyReason}
                      onChange={(e) =>
                        setReasonById((prev) => ({
                          ...prev,
                          [approval.id]: e.target.value,
                        }))
                      }
                      rows={3}
                      placeholder="Reasoning required for denial"
                      style={{
                        width: "100%",
                        resize: "vertical",
                        background: "#0f121b",
                        color: "rgba(255,255,255,0.92)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: 10,
                        fontFamily: "inherit",
                        fontSize: 12,
                      }}
                    />
                    <button
                      onClick={() => void runAction(approval, "denied", denyReason)}
                      disabled={busy || !denyReason.trim()}
                      style={{
                        border: 0,
                        borderRadius: 8,
                        background: busy || !denyReason.trim() ? "#4b5563" : "#991b1b",
                        color: "white",
                        padding: "8px 12px",
                        fontSize: 12,
                        cursor: busy || !denyReason.trim() ? "not-allowed" : "pointer",
                        justifySelf: "start",
                      }}
                    >
                      {busy ? "Processing..." : "Submit denial"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        : null}
    </div>
  );
}
