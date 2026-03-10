"use client";

import { useEffect, useMemo, useState } from "react";

type Approval = {
  id: string;
  requesting_agent_id: string | null;
  action_type: string;
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  permission_tier: number | null;
  status: string;
  proposed_payload: unknown;
  decision_reasoning: string | null;
  requested_at: string;
  decided_at: string | null;
};

type StatusTab = "pending" | "approved" | "rejected" | "all";

const TABS: StatusTab[] = ["pending", "approved", "rejected", "all"];

function riskClass(risk: Approval["risk_level"]) {
  switch (risk) {
    case "low":
      return "bg-emerald-100 text-emerald-800";
    case "medium":
      return "bg-amber-100 text-amber-800";
    case "high":
      return "bg-orange-100 text-orange-800";
    case "critical":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function formatPayload(payload: unknown): string {
  if (!payload) return "No action payload";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<StatusTab>("pending");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentById, setCommentById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadApprovals(nextTab: StatusTab) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/ops/abra/approvals?status=${nextTab}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load approvals",
        );
      }

      setApprovals(Array.isArray(data?.approvals) ? data.approvals : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadApprovals(tab);
  }, [tab]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    setError(null);

    try {
      const res = await fetch("/api/ops/abra/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          decision,
          comment: commentById[id] || "",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to update approval",
        );
      }

      await loadApprovals(tab);
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update approval");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = useMemo(
    () => approvals.filter((approval) => approval.status === "pending").length,
    [approvals],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Approvals</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review and decide agent actions by risk and permission tier.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((statusTab) => (
          <button
            key={statusTab}
            type="button"
            onClick={() => setTab(statusTab)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              tab === statusTab
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {statusTab}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        {loading
          ? "Loading approvals..."
          : `Showing ${approvals.length} approval(s)${tab === "pending" ? ` (${pendingCount} pending)` : ""}`}
      </div>

      {!loading && approvals.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-slate-600">
          No pending approvals 🎉
        </div>
      ) : null}

      <div className="grid gap-3">
        {approvals.map((approval) => {
          const expanded = expandedId === approval.id;
          const busy = busyId === approval.id;
          const isPending = approval.status === "pending";

          return (
            <article key={approval.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-900">{approval.summary}</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      agent {approval.requesting_agent_id || "unknown"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskClass(approval.risk_level)}`}>
                      risk {approval.risk_level || "unknown"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      tier {approval.permission_tier ?? "n/a"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {approval.action_type}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {approval.status}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Requested: {new Date(approval.requested_at).toLocaleString("en-US")}</div>
                  {approval.decided_at ? (
                    <div>Decided: {new Date(approval.decided_at).toLocaleString("en-US")}</div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : approval.id)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  {expanded ? "Hide payload" : "Show payload"}
                </button>
              </div>

              {expanded ? (
                <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {formatPayload(approval.proposed_payload)}
                </pre>
              ) : null}

              {isPending ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={commentById[approval.id] || ""}
                    onChange={(event) =>
                      setCommentById((prev) => ({
                        ...prev,
                        [approval.id]: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Optional comment"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  />

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(approval.id, "approved")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(approval.id, "rejected")}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : approval.decision_reasoning ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">Comment:</span> {approval.decision_reasoning}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
