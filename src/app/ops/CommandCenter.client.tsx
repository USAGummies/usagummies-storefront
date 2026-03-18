"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Play,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { useIsMobile } from "@/app/ops/hooks";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HealthStatus = "Healthy" | "Degraded" | "Critical" | "Loading";

type HealthData = {
  status: "ok" | "healthy" | "degraded" | "unhealthy";
  timestamp?: string;
  uptime_s?: number;
};

type ApprovalsData = {
  approvals: Array<{
    id: string;
    summary: string;
    action_type: string;
    requested_at: string;
  }>;
  totalPending: number;
};

type ErrorStats = {
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  totalUnresolved: number;
};

type ErrorsData = {
  errors: Array<unknown>;
  stats?: ErrorStats;
};

type MorningBriefData = {
  ok: boolean;
  brief: string;
  mode: string;
};

type LogRun = {
  engineId?: string;
  agentKey?: string;
  agentName?: string;
  agent?: string;
  label?: string;
  startedAt?: string;
  completedAt?: string;
  runAt?: string;
  status?: string;
  error?: string;
};

type LogsData = {
  runs: LogRun[];
  stats: { total: number; last24h: number; successes24h: number; failures24h: number };
  generatedAt: string;
};

type RevenueData = {
  combined: { totalRevenue: number; totalOrders: number; avgOrderValue: number };
  generatedAt: string;
};

type QuickActionResult = {
  loading: boolean;
  result: string | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDollar(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function mapHealthStatus(raw: string): HealthStatus {
  if (raw === "ok" || raw === "healthy") return "Healthy";
  if (raw === "degraded") return "Degraded";
  if (raw === "unhealthy") return "Critical";
  return "Degraded";
}

function healthDotColor(status: HealthStatus): string {
  if (status === "Healthy") return "#16a34a";
  if (status === "Degraded") return GOLD;
  if (status === "Critical") return RED;
  return TEXT_DIM;
}

// ---------------------------------------------------------------------------
// Row 1: Status Card
// ---------------------------------------------------------------------------

function StatusCard({
  label,
  children,
  onClick,
  accentColor,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  accentColor?: string;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "16px 18px",
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 0.15s ease",
        borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: TEXT_DIM,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row 3: Quick Action Button
// ---------------------------------------------------------------------------

function QuickActionButton({
  label,
  icon,
  onClick,
  loading,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        background: loading ? `${NAVY}08` : CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        cursor: loading ? "wait" : "pointer",
        color: NAVY,
        fontSize: 13,
        fontWeight: 600,
        width: "100%",
        textAlign: "left",
        transition: "background 0.15s ease",
        opacity: loading ? 0.7 : 1,
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {loading ? (
        <span style={{ fontSize: 11, color: TEXT_DIM }}>Running...</span>
      ) : (
        <ChevronRight size={14} color={TEXT_DIM} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CommandCenter() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);

  // Row 1 state
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("Loading");
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState<number | null>(null);

  // Row 2 state
  const [morningBrief, setMorningBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);

  // Row 3 state
  const [agentRuns, setAgentRuns] = useState<LogRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);

  // Quick actions state
  const [actionResults, setActionResults] = useState<Record<string, QuickActionResult>>({});

  // Timestamps for staleness
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const loadRow1 = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch("/api/ops/health", { cache: "no-store" }),
      fetch("/api/ops/approvals?status=pending", { cache: "no-store" }),
      fetch("/api/ops/dashboard", { cache: "no-store" }),
      fetch("/api/ops/errors?stats=1", { cache: "no-store" }),
    ]);

    // Health
    if (results[0].status === "fulfilled" && results[0].value.ok) {
      try {
        const data = (await results[0].value.json()) as HealthData;
        setHealthStatus(mapHealthStatus(data.status));
      } catch {
        setHealthStatus("Degraded");
      }
    } else {
      setHealthStatus("Critical");
    }

    // Approvals
    if (results[1].status === "fulfilled" && results[1].value.ok) {
      try {
        const data = (await results[1].value.json()) as ApprovalsData;
        setPendingCount(data.totalPending ?? data.approvals?.length ?? 0);
      } catch {
        setPendingCount(null);
      }
    } else {
      setPendingCount(null);
    }

    // Revenue
    if (results[2].status === "fulfilled" && results[2].value.ok) {
      try {
        const data = (await results[2].value.json()) as RevenueData;
        setTodayRevenue(data.combined?.totalRevenue ?? null);
      } catch {
        setTodayRevenue(null);
      }
    } else {
      setTodayRevenue(null);
    }

    // Errors
    if (results[3].status === "fulfilled" && results[3].value.ok) {
      try {
        const data = (await results[3].value.json()) as ErrorsData;
        setErrorCount(data.stats?.totalUnresolved ?? data.errors?.length ?? 0);
      } catch {
        setErrorCount(null);
      }
    } else {
      setErrorCount(null);
    }
  }, []);

  const loadBrief = useCallback(async () => {
    setBriefLoading(true);
    try {
      const res = await fetch("/api/ops/abra/morning-brief?mode=quick", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as MorningBriefData;
        setMorningBrief(data.brief || null);
      } else {
        setMorningBrief(null);
      }
    } catch {
      setMorningBrief(null);
    }
    setBriefLoading(false);
  }, []);

  const loadAgentRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch("/api/ops/logs?limit=10", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as LogsData;
        setAgentRuns(Array.isArray(data.runs) ? data.runs.slice(0, 10) : []);
      } else {
        setAgentRuns([]);
      }
    } catch {
      setAgentRuns([]);
    }
    setRunsLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadRow1(), loadBrief(), loadAgentRuns()]);
    setLastRefresh(new Date().toISOString());
    setLoading(false);
  }, [loadRow1, loadBrief, loadAgentRuns]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ---------------------------------------------------------------------------
  // Quick Actions
  // ---------------------------------------------------------------------------

  const runQuickAction = useCallback(
    async (key: string, endpoint: string, method: "GET" | "POST" = "POST") => {
      setActionResults((prev) => ({
        ...prev,
        [key]: { loading: true, result: null, error: null },
      }));

      try {
        const res = await fetch(endpoint, { method, cache: "no-store" });
        const text = await res.text();
        let msg: string;
        try {
          const json = JSON.parse(text);
          msg = json.ok
            ? json.brief
              ? "Brief generated successfully"
              : json.message || "Done"
            : json.error || `HTTP ${res.status}`;
        } catch {
          msg = res.ok ? "Done" : `HTTP ${res.status}`;
        }

        setActionResults((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            result: res.ok ? msg : null,
            error: res.ok ? null : msg,
          },
        }));
      } catch (err) {
        setActionResults((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            result: null,
            error: err instanceof Error ? err.message : "Request failed",
          },
        }));
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Staleness badge items
  // ---------------------------------------------------------------------------

  const freshnessItems = useMemo(
    () => [{ label: "Dashboard", timestamp: lastRefresh }],
    [lastRefresh],
  );

  const pageDate = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
            Command Center
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>{pageDate}</div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton loading={loading} onClick={() => void loadAll()} />
      </div>

      {/* ================================================================= */}
      {/* ROW 1: Status Cards                                               */}
      {/* ================================================================= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(4, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {loading && healthStatus === "Loading" ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <SkeletonTable rows={2} />
          </div>
        ) : (
          <>
            {/* System Health */}
            <StatusCard label="System Health" accentColor={healthDotColor(healthStatus)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: healthDotColor(healthStatus),
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: NAVY,
                  }}
                >
                  {healthStatus}
                </span>
              </div>
            </StatusCard>

            {/* Pending Approvals */}
            <StatusCard
              label="Pending Approvals"
              onClick={() => { window.location.href = "/ops/alerts"; }}
              accentColor={pendingCount && pendingCount > 0 ? GOLD : undefined}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: NAVY }}>
                  {pendingCount !== null ? pendingCount : "--"}
                </span>
                <ChevronRight size={16} color={TEXT_DIM} style={{ marginTop: 4 }} />
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 2 }}>
                Click to review
              </div>
            </StatusCard>

            {/* Today's Revenue */}
            <StatusCard label="Today's Revenue">
              <div style={{ fontSize: 30, fontWeight: 800, color: NAVY }}>
                {todayRevenue !== null ? fmtDollar(todayRevenue) : "--"}
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 2 }}>
                Shopify + Amazon combined
              </div>
            </StatusCard>

            {/* Active Errors */}
            <StatusCard
              label="Active Errors"
              accentColor={errorCount && errorCount > 0 ? RED : undefined}
            >
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: errorCount && errorCount > 0 ? RED : NAVY,
                }}
              >
                {errorCount !== null ? errorCount : "--"}
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 2 }}>
                {errorCount && errorCount > 0 ? "Unresolved" : "All clear"}
              </div>
            </StatusCard>
          </>
        )}
      </div>

      {/* ================================================================= */}
      {/* ROW 2: Morning Brief                                              */}
      {/* ================================================================= */}
      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "16px 20px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Activity size={16} color={NAVY} />
          <span style={{ fontSize: 14, color: NAVY, fontWeight: 800 }}>
            Morning Brief
          </span>
        </div>
        {briefLoading ? (
          <SkeletonTable rows={3} />
        ) : morningBrief ? (
          <pre
            style={{
              margin: 0,
              fontSize: 13,
              color: NAVY,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
            }}
          >
            {morningBrief}
          </pre>
        ) : (
          <div
            style={{
              color: TEXT_DIM,
              fontSize: 13,
              fontStyle: "italic",
              padding: "8px 0",
            }}
          >
            Morning brief not yet generated. Use Quick Actions to create one.
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* ROW 3: Agent Runs + Quick Actions                                 */}
      {/* ================================================================= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 12,
        }}
      >
        {/* Left: Recent Agent Runs */}
        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Clock3 size={16} color={NAVY} />
            <span style={{ fontSize: 14, color: NAVY, fontWeight: 800 }}>
              Recent Agent Runs
            </span>
          </div>

          {runsLoading ? (
            <SkeletonTable rows={5} />
          ) : agentRuns.length === 0 ? (
            <div style={{ color: TEXT_DIM, fontSize: 13 }}>
              No recent agent runs found.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {agentRuns.map((run, i) => {
                const name =
                  run.agentName || run.agent || run.label || run.agentKey || "Unknown";
                const time =
                  run.completedAt || run.startedAt || run.runAt || "";
                const isSuccess =
                  run.status === "success" ||
                  run.status === "ok" ||
                  run.status === "completed";
                const isFail =
                  run.status === "error" ||
                  run.status === "failed" ||
                  run.status === "failure";

                return (
                  <div
                    key={run.agentKey ? `${run.agentKey}-${i}` : i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 0",
                      borderBottom:
                        i < agentRuns.length - 1
                          ? `1px solid ${BORDER}`
                          : "none",
                    }}
                  >
                    {isSuccess ? (
                      <CheckCircle2
                        size={14}
                        color="#16a34a"
                        style={{ flexShrink: 0 }}
                      />
                    ) : isFail ? (
                      <XCircle
                        size={14}
                        color={RED}
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <AlertTriangle
                        size={14}
                        color={GOLD}
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 13,
                        color: NAVY,
                        fontWeight: 600,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: TEXT_DIM,
                        flexShrink: 0,
                      }}
                    >
                      {time ? fmtTime(time) : "--"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Quick Actions */}
        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Play size={16} color={NAVY} />
            <span style={{ fontSize: 14, color: NAVY, fontWeight: 800 }}>
              Quick Actions
            </span>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <QuickActionButton
              label="Run Morning Brief"
              icon={<Activity size={14} color={GOLD} />}
              loading={actionResults["brief"]?.loading ?? false}
              onClick={() =>
                runQuickAction(
                  "brief",
                  "/api/ops/abra/morning-brief?mode=full",
                  "GET",
                )
              }
            />
            <QuickActionButton
              label="Generate P&L"
              icon={<ShieldCheck size={14} color={GOLD} />}
              loading={actionResults["pnl"]?.loading ?? false}
              onClick={() =>
                runQuickAction("pnl", "/api/ops/pnl", "GET")
              }
            />
            <QuickActionButton
              label="Run Monthly Close"
              icon={<Clock3 size={14} color={GOLD} />}
              loading={actionResults["close"]?.loading ?? false}
              onClick={() =>
                runQuickAction(
                  "close",
                  "/api/ops/finance/close",
                  "POST",
                )
              }
            />
            <QuickActionButton
              label="Check Health"
              icon={<CheckCircle2 size={14} color={GOLD} />}
              loading={actionResults["health"]?.loading ?? false}
              onClick={() =>
                runQuickAction("health", "/api/ops/health", "GET")
              }
            />
          </div>

          {/* Action result feedback */}
          {Object.entries(actionResults).map(([key, ar]) => {
            if (ar.loading || (!ar.result && !ar.error)) return null;
            return (
              <div
                key={key}
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  border: `1px solid ${ar.error ? `${RED}44` : "#16a34a44"}`,
                  background: ar.error ? `${RED}08` : "#16a34a08",
                  color: ar.error ? RED : "#16a34a",
                  fontWeight: 600,
                }}
              >
                {ar.error ? `Error: ${ar.error}` : ar.result}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
