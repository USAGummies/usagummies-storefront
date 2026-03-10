"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  Mail,
  CheckCircle2,
  Target,
  TrendingUp,
  DollarSign,
  Package,
  Landmark,
  ChevronDown,
  ChevronUp,
  Brain,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  useAlerts,
  useAuditStatus,
  useDashboardData,
  useBalancesData,
  comparePlanVsActual,
  fmtDollar,
  fmtPercent,
  STATUS_COLORS,
  type PlanVsActual,
} from "@/lib/ops/use-war-room-data";
import {
  MONTHS,
  MONTH_LABELS,
  TOTAL_REVENUE,
  TOTAL_UNITS,
  TOTAL_GROSS_PROFIT,
  EBITDA,
  PROJECTED_CASH,
  LOAN_BALANCE,
  LOAN_REPAYMENT,
  ANNUAL_SUMMARY,
  MILESTONES,
  LOAN,
  TOTAL_OPEX,
  AMORTIZATION_SCHEDULE,
  getCurrentProFormaMonth,
  getMonthsThrough,
  cumulativeThrough,
  type Month,
} from "@/lib/ops/pro-forma";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart } from "@/app/ops/components/Skeleton";
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
// Helpers
// ---------------------------------------------------------------------------

type PriorityFilter = "all" | "critical" | "warning" | "info";

const GREEN = "#16a34a";
const KPI_METRICS = [
  "daily_revenue_shopify",
  "daily_revenue_amazon",
  "daily_orders_shopify",
  "daily_orders_amazon",
  "daily_sessions",
  "daily_pageviews",
  "daily_aov",
] as const;

type MetricPoint = { date: string; value: number };
type KpiHistoryResponse = {
  metrics: Record<string, MetricPoint[]>;
  range: { start: string; end: string; days: number };
};

type ChartRow = {
  date: string;
  dayLabel: string;
  daily_revenue_shopify: number;
  daily_revenue_amazon: number;
  daily_revenue_total: number;
  daily_orders_shopify: number;
  daily_orders_amazon: number;
  daily_orders_total: number;
  daily_sessions: number;
  daily_pageviews: number;
  daily_aov: number;
};

type AnomalyRecord = {
  date: string;
  metric: string;
  direction: "spike" | "drop";
  severity: "info" | "warning" | "critical";
  z_score: number;
  deviation_pct: number;
  current_value: number;
  expected_value: number;
};

function pvaColor(pva: PlanVsActual): string {
  return STATUS_COLORS[pva.status];
}

function statusLabel(pva: PlanVsActual): string {
  if (pva.status === "no-data") return "—";
  const sign = pva.variancePct >= 0 ? "+" : "";
  return `${sign}${(pva.variancePct * 100).toFixed(1)}%`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctDelta(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function fmtDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}% vs 7d avg`;
}

function anomalyColor(severity: AnomalyRecord["severity"]): string {
  if (severity === "critical") return RED;
  if (severity === "warning") return "#f59e0b";
  return "#2563eb";
}

function anomalyIcon(anomaly: AnomalyRecord): string {
  const sev = anomaly.severity === "critical" ? "🔴" : anomaly.severity === "warning" ? "🟡" : "🔵";
  const dir = anomaly.direction === "spike" ? "▲" : "▼";
  return `${sev}${dir}`;
}

function metricShort(metric: string): string {
  return metric.replace("daily_", "").replaceAll("_", " ");
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildChartRows(history: KpiHistoryResponse | null): ChartRow[] {
  if (!history) return [];

  const dateSet = new Set<string>();
  for (const metric of KPI_METRICS) {
    for (const point of history.metrics?.[metric] || []) {
      dateSet.add(point.date);
    }
  }

  const sortedDates = [...dateSet].sort((a, b) => a.localeCompare(b));
  return sortedDates.map((date) => {
    const getMetric = (name: string): number => {
      const points = history.metrics?.[name] || [];
      const point = points.find((item) => item.date === date);
      return Number(point?.value || 0);
    };

    const revenueShopify = getMetric("daily_revenue_shopify");
    const revenueAmazon = getMetric("daily_revenue_amazon");
    const ordersShopify = getMetric("daily_orders_shopify");
    const ordersAmazon = getMetric("daily_orders_amazon");
    const sessions = getMetric("daily_sessions");
    const pageviews = getMetric("daily_pageviews");
    const aov = getMetric("daily_aov");

    return {
      date,
      dayLabel: formatDayLabel(date),
      daily_revenue_shopify: revenueShopify,
      daily_revenue_amazon: revenueAmazon,
      daily_revenue_total: revenueShopify + revenueAmazon,
      daily_orders_shopify: ordersShopify,
      daily_orders_amazon: ordersAmazon,
      daily_orders_total: ordersShopify + ordersAmazon,
      daily_sessions: sessions,
      daily_pageviews: pageviews,
      daily_aov: aov,
    };
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  plan,
  actual,
  icon,
  prefix,
  suffix,
  invertVariance,
}: {
  label: string;
  plan: number;
  actual: number | null;
  icon: React.ReactNode;
  prefix?: string;
  suffix?: string;
  invertVariance?: boolean;
}) {
  const pva = comparePlanVsActual(plan, actual);
  // For OpEx-like metrics, lower actual is good (flip color)
  const effectivePva = invertVariance
    ? { ...pva, status: pva.status === "ahead" ? "behind" as const : pva.status === "behind" ? "ahead" as const : pva.status }
    : pva;

  const displayValue = actual != null
    ? `${prefix || ""}${Math.round(actual).toLocaleString("en-US")}${suffix || ""}`
    : "—";
  const planLabel = `${prefix || ""}${Math.round(plan).toLocaleString("en-US")}${suffix || ""} plan`;

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>{displayValue}</div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: TEXT_DIM }}>{planLabel}</span>
        {actual != null && (
          <span
            style={{
              color: pvaColor(effectivePva),
              background: `${pvaColor(effectivePva)}14`,
              borderRadius: 999,
              padding: "2px 8px",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {statusLabel(pva)}
          </span>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{(pct * 100).toFixed(1)}%</span>
      </div>
      <div style={{ width: "100%", height: 10, borderRadius: 99, background: `${BORDER}` }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 99, background: color, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function MilestoneRow({
  label,
  targetMonth,
  achieved,
  current,
}: {
  label: string;
  targetMonth: string;
  achieved: boolean;
  current?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 99,
          background: achieved ? GREEN : `${BORDER}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {achieved && <CheckCircle2 size={14} color="#fff" />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: achieved ? GREEN : NAVY }}>{label}</div>
        <div style={{ fontSize: 11, color: TEXT_DIM }}>Target: {targetMonth}{current ? ` · ${current}` : ""}</div>
      </div>
    </div>
  );
}

function LiveMetricCard({
  title,
  subtitle,
  children,
  staleDate,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  staleDate: string | null;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, color: NAVY, fontWeight: 800 }}>{title}</div>
          <div style={{ marginTop: 3, fontSize: 12, color: TEXT_DIM }}>{subtitle}</div>
        </div>
        <StalenessBadge items={[{ label: "Latest", timestamp: staleDate }]} />
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export function KpisView() {
  const isMobile = useIsMobile();
  const { data: session } = useSession();
  const [filter, setFilter] = useState<PriorityFilter>("all");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [brain, setBrain] = useState<{ insights: string[]; sources: { title: string; source_table: string }[] } | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [kpiHistory, setKpiHistory] = useState<KpiHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [anomaliesError, setAnomaliesError] = useState<string | null>(null);
  const [expandedAnomalyKey, setExpandedAnomalyKey] = useState<string | null>(null);

  const fetchBrainInsights = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch("/api/ops/abra/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "KPIs revenue milestones targets performance gummy business growth" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch insights");
      setBrain(data);
    } catch (err) {
      setBrainError(err instanceof Error ? err.message : "Brain query failed");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  const fetchKpiHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams({
        days: "30",
        metrics: KPI_METRICS.join(","),
      });
      const res = await fetch(`/api/ops/abra/kpi-history?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as KpiHistoryResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load KPI history");
      setKpiHistory(data);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load KPI history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKpiHistory();
  }, [fetchKpiHistory]);

  const fetchAnomalyHistory = useCallback(async () => {
    setAnomaliesLoading(true);
    setAnomaliesError(null);
    try {
      const res = await fetch("/api/ops/abra/anomaly-history?days=30", {
        cache: "no-store",
      });
      const data = (await res.json()) as { anomalies?: AnomalyRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load anomalies");
      setAnomalies(Array.isArray(data.anomalies) ? data.anomalies : []);
    } catch (err) {
      setAnomaliesError(err instanceof Error ? err.message : "Failed to load anomalies");
    } finally {
      setAnomaliesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAnomalyHistory();
  }, [fetchAnomalyHistory]);

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
  const { data: dashboard, loading: dashLoading, refresh: refreshDash } = useDashboardData();
  const { data: balances, loading: balLoading } = useBalancesData();

  const currentMonth = getCurrentProFormaMonth();
  const monthsElapsed = currentMonth ? getMonthsThrough(currentMonth) : [];

  // Plan vs actual computations
  const planRevenueCum = currentMonth ? cumulativeThrough(TOTAL_REVENUE, currentMonth) : 0;
  const planUnitsCum = currentMonth ? cumulativeThrough(TOTAL_UNITS, currentMonth) : 0;
  const planEbitdaCum = currentMonth ? cumulativeThrough(EBITDA, currentMonth) : 0;
  const planCash = currentMonth ? PROJECTED_CASH[currentMonth] : 0;

  // Actuals from live APIs
  const actualRevenue = dashboard?.combined.totalRevenue ?? null;
  const actualOrders = dashboard?.combined.totalOrders ?? null;
  const actualCash = balances?.totalCash ?? null;

  // Monthly table data
  const monthlyRows = useMemo(() => {
    return MONTHS.map((m) => ({
      month: m,
      label: MONTH_LABELS[m],
      revenue: TOTAL_REVENUE[m],
      units: TOTAL_UNITS[m],
      gp: TOTAL_GROSS_PROFIT[m],
      opex: TOTAL_OPEX[m],
      ebitda: EBITDA[m],
      cash: PROJECTED_CASH[m],
      loanPayment: LOAN_REPAYMENT[m],
      loanBalance: LOAN_BALANCE[m],
      isPast: monthsElapsed.includes(m),
    }));
  }, [monthsElapsed]);

  // Milestone status — ONLY mark achieved when verified by REAL data.
  // Do NOT auto-achieve based on month index. If we don't have live data,
  // the milestone stays pending. Trust is everything.
  const milestoneStatuses = useMemo(() => {
    return MILESTONES.map((ms) => {
      let achieved = false;

      // Only check milestones that can be verified by actual live data.
      // Everything else stays false until we have real confirmation.
      switch (ms.id) {
        case "ebitda-positive":
          // Only achievable once we have real P&L data from Plaid
          achieved = false;
          break;
        case "first-distributor":
          // Not yet — Inderbitzin expected to start May 2026
          achieved = false;
          break;
        case "second-distributor":
        case "third-distributor":
          achieved = false;
          break;
        case "first-reorder":
        case "second-reorder":
          achieved = false;
          break;
        case "loan-repayment-start":
          // Repayment starts Aug 2026 per loan terms
          achieved = false;
          break;
        case "cash-floor":
          // Only check against actual cash, never projected
          if (actualCash != null) {
            achieved = actualCash > ms.threshold;
          }
          break;
        case "100k-units":
          // Only from actual order data, not pro-forma projections
          if (actualOrders != null) {
            achieved = actualOrders >= ms.threshold;
          }
          break;
        case "loan-payoff":
          achieved = false; // Feb 2028
          break;
      }

      return { ...ms, achieved };
    });
  }, [actualCash, actualOrders]);

  const achievedCount = milestoneStatuses.filter((m) => m.achieved).length;

  // Loan payoff progress — ACTUAL repaid, not plan.
  // Repayment hasn't started yet (starts Aug 2026). $0 repaid to date.
  const totalRepaid2026 = 0;

  // Amortization YTD
  const amortYtd = AMORTIZATION_SCHEDULE.filter((a) => a.month.includes("2026"));
  const totalPrincipalYtd = amortYtd.reduce((s, a) => s + a.principalPortion, 0);
  const totalInterestYtd = amortYtd.reduce((s, a) => s + a.interestPortion, 0);

  // Alerts
  const visibleAlerts = useMemo(() => {
    const rows = alerts?.alerts || [];
    if (filter === "all") return rows;
    return rows.filter((a) => a.priority === filter);
  }, [alerts, filter]);

  const freshnessItems = [
    { label: "Revenue", timestamp: dashboard?.generatedAt },
    { label: "Balances", timestamp: balances?.lastUpdated },
    { label: "Alerts", timestamp: alerts?.lastFetched },
    { label: "Audit", timestamp: audit?.lastFetched },
  ];

  const anyLoading =
    alertsLoading || auditLoading || dashLoading || balLoading || historyLoading || anomaliesLoading;

  const chartRows = useMemo(() => buildChartRows(kpiHistory), [kpiHistory]);
  const latestChart = chartRows[chartRows.length - 1] || null;
  const previous7Rows = chartRows.slice(Math.max(chartRows.length - 8, 0), chartRows.length - 1);

  const revenueMeta = useMemo(() => {
    const current = latestChart?.daily_revenue_total || 0;
    const baseline = avg(previous7Rows.map((row) => row.daily_revenue_total));
    return { current, delta: pctDelta(current, baseline) };
  }, [latestChart?.daily_revenue_total, previous7Rows]);

  const ordersMeta = useMemo(() => {
    const current = latestChart?.daily_orders_total || 0;
    const baseline = avg(previous7Rows.map((row) => row.daily_orders_total));
    return { current, delta: pctDelta(current, baseline) };
  }, [latestChart?.daily_orders_total, previous7Rows]);

  const trafficMeta = useMemo(() => {
    const current = latestChart?.daily_sessions || 0;
    const baseline = avg(previous7Rows.map((row) => row.daily_sessions));
    return { current, delta: pctDelta(current, baseline) };
  }, [latestChart?.daily_sessions, previous7Rows]);

  const aovMeta = useMemo(() => {
    const current = latestChart?.daily_aov || 0;
    const baseline = avg(previous7Rows.map((row) => row.daily_aov));
    const avg30 = avg(chartRows.map((row) => row.daily_aov));
    return { current, delta: pctDelta(current, baseline), avg30 };
  }, [latestChart?.daily_aov, previous7Rows, chartRows]);

  const chartHeight = isMobile ? 250 : 300;
  const revenueAnomalies = useMemo(
    () =>
      anomalies.filter(
        (row) =>
          row.metric === "daily_revenue_shopify" || row.metric === "daily_revenue_amazon",
      ),
    [anomalies],
  );
  const ordersAnomalies = useMemo(
    () =>
      anomalies.filter(
        (row) =>
          row.metric === "daily_orders_shopify" || row.metric === "daily_orders_amazon",
      ),
    [anomalies],
  );
  const timelineAnomalies = useMemo(() => anomalies.slice(0, 30), [anomalies]);

  // Alert actions (preserved from original)
  async function recordAlertAction(
    alert: { id: string; title: string; source: string },
    action: "resolved" | "reopened" | "draft_email",
  ) {
    const res = await fetch("/api/ops/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertId: alert.id,
        action,
        title: alert.title,
        source: alert.source,
        resolvedBy: session?.user?.email || session?.user?.name || "ops-user",
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
  }

  async function markDone(alert: { id: string; title: string; source: string }) {
    try {
      await recordAlertAction(alert, "resolved");
      setActionMsg(`Marked "${alert.title}" as resolved.`);
      refreshAlerts();
      setTimeout(() => setActionMsg(null), 2500);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Failed to resolve alert");
      setTimeout(() => setActionMsg(null), 2500);
    }
  }

  async function draftEmail(alert: { id: string; title: string; source: string; message: string }) {
    try { await recordAlertAction(alert, "draft_email"); } catch { /* continue */ }
    const subject = `Action required: ${alert.title}`;
    const body = `Hi team,\n\nPlease review this alert:\n\n${alert.title}\n${alert.message}\n\nThanks.`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function refreshAll() {
    refreshAlerts();
    refreshAudit();
    refreshDash();
    void fetchKpiHistory();
    void fetchAnomalyHistory();
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>KPIs & Milestones</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Pro Forma v23 targets vs live actuals — full-year 2026 tracking.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => void fetchBrainInsights()}
            disabled={brainLoading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: `1px solid ${brain ? `${GOLD}60` : BORDER}`,
              borderRadius: 10, background: brain ? `${GOLD}0d` : CARD,
              color: NAVY, padding: "8px 12px", fontSize: 12, fontWeight: 700,
              cursor: brainLoading ? "default" : "pointer",
              opacity: brainLoading ? 0.7 : 1,
            }}
          >
            <Brain size={14} />
            {brainLoading ? "Thinking..." : brain ? "Refresh Intel" : "🧠 Intel"}
          </button>
          <RefreshButton loading={anyLoading} onClick={refreshAll} />
        </div>
      </div>

      {brainError && (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}0a`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: RED }}>
          🧠 Brain: {brainError}
        </div>
      )}
      {brain && brain.insights.length > 0 && (
        <div style={{ background: `${GOLD}0d`, border: `1px solid ${GOLD}30`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 14 }}>
            <Brain size={16} /> Business Intelligence
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {brain.insights.map((insight, i) => (
              <li key={i} style={{ fontSize: 13, color: NAVY, lineHeight: 1.6, marginBottom: 4 }}>{insight}</li>
            ))}
          </ul>
          {brain.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {brain.sources.map((s, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: s.source_table === "email" ? `${NAVY}10` : `${GOLD}18`,
                  border: `1px solid ${s.source_table === "email" ? `${NAVY}20` : `${GOLD}30`}`,
                  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: NAVY, fontWeight: 600,
                }}>
                  {s.source_table === "email" ? "📧" : "🧠"} {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(alertsError || auditError) && (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}14`, color: RED, borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
          <AlertTriangle size={16} />
          {alertsError || auditError}
        </div>
      )}
      {actionMsg && (
        <div style={{ border: `1px solid ${NAVY}2b`, background: `${NAVY}10`, color: NAVY, borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          {actionMsg}
        </div>
      )}

      {/* ── Live Metrics ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Live Metrics (Last 30 Days)
        </div>

        {historyError ? (
          <div style={{ border: `1px solid ${RED}33`, background: `${RED}0a`, color: RED, borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13 }}>
            {historyError}
          </div>
        ) : null}

        {historyLoading && chartRows.length === 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 10,
            }}
          >
            <SkeletonChart height={chartHeight} />
            <SkeletonChart height={chartHeight} />
            <SkeletonChart height={chartHeight} />
            <SkeletonChart height={chartHeight} />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 10,
            }}
          >
            <LiveMetricCard
              title="Revenue — Last 30 Days"
              subtitle={`${fmtDollar(revenueMeta.current)} today • ${fmtDelta(revenueMeta.delta)}`}
              staleDate={latestChart?.date || null}
            >
              <div style={{ width: "100%", height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartRows}>
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} tickFormatter={(value) => `$${Number(value).toLocaleString("en-US")}`} />
                    <Tooltip
                      formatter={(value, key) => {
                        const numericValue = Number(value || 0);
                        const keyName = String(key || "");
                        const label =
                          keyName === "daily_revenue_shopify"
                            ? "Shopify"
                            : keyName === "daily_revenue_amazon"
                              ? "Amazon"
                              : "Total";
                        return [fmtDollar(numericValue), label];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="daily_revenue_total"
                      fill={GOLD}
                      fillOpacity={0.12}
                      stroke="none"
                      name="Total"
                    />
                    <Line type="monotone" dataKey="daily_revenue_shopify" stroke={NAVY} strokeWidth={2} dot={false} name="Shopify" />
                    <Line type="monotone" dataKey="daily_revenue_amazon" stroke={RED} strokeWidth={2} dot={false} name="Amazon" />
                    {revenueAnomalies.map((anomaly, index) => {
                      const row = chartRows.find((item) => item.date === anomaly.date);
                      if (!row) return null;
                      const y =
                        anomaly.metric === "daily_revenue_amazon"
                          ? row.daily_revenue_amazon
                          : row.daily_revenue_shopify;
                      return (
                        <ReferenceDot
                          key={`${anomaly.metric}:${anomaly.date}:${index}`}
                          x={row.dayLabel}
                          y={y}
                          r={anomaly.severity === "critical" ? 6 : 5}
                          fill={anomalyColor(anomaly.severity)}
                          stroke="#fff"
                          strokeWidth={2}
                          label={
                            anomaly.severity === "critical"
                              ? { value: "!", position: "center", fill: "#fff", fontSize: 9, fontWeight: 700 }
                              : undefined
                          }
                        />
                      );
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </LiveMetricCard>

            <LiveMetricCard
              title="Orders — Last 30 Days"
              subtitle={`${Math.round(ordersMeta.current).toLocaleString("en-US")} today • ${fmtDelta(ordersMeta.delta)}`}
              staleDate={latestChart?.date || null}
            >
              <div style={{ width: "100%", height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows}>
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <Tooltip
                      formatter={(value, key) => {
                        const numericValue = Number(value || 0);
                        const keyName = String(key || "");
                        const label = keyName === "daily_orders_shopify" ? "Shopify" : "Amazon";
                        return [Math.round(numericValue), label];
                      }}
                    />
                    <Bar dataKey="daily_orders_shopify" stackId="orders" fill={NAVY} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="daily_orders_amazon" stackId="orders" fill={RED} radius={[2, 2, 0, 0]} />
                    {ordersAnomalies.map((anomaly, index) => {
                      const row = chartRows.find((item) => item.date === anomaly.date);
                      if (!row) return null;
                      const y =
                        anomaly.metric === "daily_orders_amazon"
                          ? row.daily_orders_amazon
                          : row.daily_orders_shopify;
                      return (
                        <ReferenceDot
                          key={`${anomaly.metric}:${anomaly.date}:${index}`}
                          x={row.dayLabel}
                          y={y}
                          r={anomaly.severity === "critical" ? 6 : 5}
                          fill={anomalyColor(anomaly.severity)}
                          stroke="#fff"
                          strokeWidth={2}
                          label={
                            anomaly.severity === "critical"
                              ? { value: "!", position: "center", fill: "#fff", fontSize: 9, fontWeight: 700 }
                              : undefined
                          }
                        />
                      );
                    })}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </LiveMetricCard>

            <LiveMetricCard
              title="Traffic & Engagement"
              subtitle={`${Math.round(trafficMeta.current).toLocaleString("en-US")} sessions today • ${fmtDelta(trafficMeta.delta)}`}
              staleDate={latestChart?.date || null}
            >
              <div style={{ width: "100%", height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows}>
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <Tooltip
                      formatter={(value, key) => {
                        const numericValue = Number(value || 0);
                        const keyName = String(key || "");
                        const label = keyName === "daily_sessions" ? "Sessions" : "Pageviews";
                        return [Math.round(numericValue).toLocaleString("en-US"), label];
                      }}
                    />
                    <Line type="monotone" dataKey="daily_sessions" stroke={NAVY} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="daily_pageviews" stroke={GOLD} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </LiveMetricCard>

            <LiveMetricCard
              title="AOV Trend — Last 30 Days"
              subtitle={`${fmtDollar(aovMeta.current)} today • ${fmtDelta(aovMeta.delta)}`}
              staleDate={latestChart?.date || null}
            >
              <div style={{ width: "100%", height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows}>
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                    <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
                    <Tooltip formatter={(value) => [fmtDollar(Number(value || 0)), "AOV"]} />
                    <ReferenceLine y={aovMeta.avg30} stroke={TEXT_DIM} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="daily_aov" stroke={GOLD} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </LiveMetricCard>
          </div>
        )}
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Anomaly Log — Last 30 Days</div>
        {anomaliesError ? (
          <div style={{ color: RED, fontSize: 13 }}>{anomaliesError}</div>
        ) : timelineAnomalies.length === 0 ? (
          <div style={{ color: TEXT_DIM, fontSize: 13 }}>
            {anomaliesLoading ? "Detecting anomalies..." : "No anomalies detected in the selected period."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Date</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Metric</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Type</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Deviation</th>
                </tr>
              </thead>
              <tbody>
                {timelineAnomalies.map((anomaly, index) => {
                  const key = `${anomaly.metric}:${anomaly.date}:${index}`;
                  const expanded = expandedAnomalyKey === key;
                  return [
                      <tr key={`${key}:row`}>
                        <td
                          style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontSize: 12, cursor: "pointer" }}
                          onClick={() => setExpandedAnomalyKey(expanded ? null : key)}
                        >
                          {formatDayLabel(anomaly.date)}
                        </td>
                        <td
                          style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}
                          onClick={() => setExpandedAnomalyKey(expanded ? null : key)}
                        >
                          {metricShort(anomaly.metric)}
                        </td>
                        <td
                          style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: anomalyColor(anomaly.severity), fontSize: 12, cursor: "pointer", fontWeight: 700 }}
                          onClick={() => setExpandedAnomalyKey(expanded ? null : key)}
                        >
                          {anomalyIcon(anomaly)}
                        </td>
                        <td
                          style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontSize: 12, cursor: "pointer" }}
                          onClick={() => setExpandedAnomalyKey(expanded ? null : key)}
                        >
                          {anomaly.deviation_pct > 0 ? "+" : ""}
                          {anomaly.deviation_pct.toFixed(1)}% (z={anomaly.z_score.toFixed(2)})
                        </td>
                      </tr>,
                      expanded ? (
                        <tr key={`${key}:detail`}>
                          <td colSpan={4} style={{ padding: "0 0 10px", color: TEXT_DIM, fontSize: 12 }}>
                            Expected: {anomaly.expected_value.toLocaleString("en-US")} · Current:{" "}
                            {anomaly.current_value.toLocaleString("en-US")}
                          </td>
                        </tr>
                      ) : null,
                    ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Top KPI Cards ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard
          label="Revenue YTD"
          plan={planRevenueCum}
          actual={actualRevenue}
          icon={<DollarSign size={16} />}
          prefix="$"
        />
        <KpiCard
          label="Orders YTD"
          plan={planUnitsCum}
          actual={actualOrders}
          icon={<Package size={16} />}
        />
        <KpiCard
          label="EBITDA YTD (Plan)"
          plan={planEbitdaCum}
          actual={planEbitdaCum}
          icon={<TrendingUp size={16} />}
          prefix="$"
        />
        <KpiCard
          label="Cash Position"
          plan={planCash}
          actual={actualCash}
          icon={<Landmark size={16} />}
          prefix="$"
        />
      </div>

      {/* ── Annual Snapshot (Pro Forma Plan Targets) ──────────────── */}
      <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Annual Plan Targets (Pro Forma v23 — not actuals)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Annual Revenue Target</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>{fmtDollar(ANNUAL_SUMMARY.totalRevenue)}</div>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>{ANNUAL_SUMMARY.totalUnits.toLocaleString()} units · {fmtPercent(ANNUAL_SUMMARY.blendedGrossMargin)} margin</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Loan Obligation</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>{fmtDollar(LOAN.totalObligation)}</div>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>
            {fmtDollar(LOAN.principal)} principal + {fmtDollar(LOAN.totalInterest)} interest · Payoff {LOAN.projectedPayoffDate}
          </div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Closing Cash (Dec 31)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>{fmtDollar(ANNUAL_SUMMARY.closingCashDec31)}</div>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>
            Plan: {fmtDollar(ANNUAL_SUMMARY.totalLoanRepayment2026)} in repayments · Loan bal {fmtDollar(ANNUAL_SUMMARY.loanBalanceDec31)}
          </div>
        </div>
      </div>

      {/* ── Milestones + Loan Progress ────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, marginBottom: 14 }}>
        {/* Milestones */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Target size={16} color={NAVY} />
            <div style={{ fontWeight: 700, color: NAVY }}>
              Milestones ({achievedCount}/{milestoneStatuses.length})
            </div>
          </div>

          <div style={{ display: "grid", gap: 2 }}>
            {milestoneStatuses.map((ms) => (
              <MilestoneRow
                key={ms.id}
                label={ms.label}
                targetMonth={typeof ms.targetMonth === "string"
                  ? (MONTHS.includes(ms.targetMonth as Month)
                    ? `${(ms.targetMonth as string).charAt(0).toUpperCase() + (ms.targetMonth as string).slice(1)} 2026`
                    : ms.targetMonth)
                  : ms.targetMonth}
                achieved={ms.achieved}
              />
            ))}
          </div>
        </div>

        {/* Loan Payoff Progress */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Landmark size={16} color={NAVY} />
            <div style={{ fontWeight: 700, color: NAVY }}>Loan Payoff Tracker</div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <ProgressBar
              value={totalRepaid2026}
              max={LOAN.totalObligation}
              color={NAVY}
              label={`${fmtDollar(totalRepaid2026)} of ${fmtDollar(LOAN.totalObligation)} repaid to date`}
            />
            <div style={{ fontSize: 11, color: GOLD, fontWeight: 600, marginTop: 4 }}>
              Repayment starts Aug 2026 (15% of gross revenue). No payments made yet.
            </div>

            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: TEXT_DIM }}>2026 Principal</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(totalPrincipalYtd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: TEXT_DIM }}>2026 Interest</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(totalInterestYtd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: TEXT_DIM }}>Split</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {fmtPercent(LOAN.principalRatio)} P / {fmtPercent(LOAN.interestRatio)} I
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: TEXT_DIM }}>Repayment starts</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>Aug 2026 (15% of gross)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: TEXT_DIM }}>Full payoff</span>
                <span style={{ color: GREEN, fontWeight: 700 }}>{LOAN.projectedPayoffDate}</span>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                2026 Monthly Repayments <span style={{ color: GOLD, fontWeight: 800 }}>(PROJECTED)</span>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {amortYtd.map((a) => (
                  <div key={a.month} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: TEXT_DIM }}>{a.month}</span>
                    <span style={{ color: NAVY, fontWeight: 600 }}>
                      {fmtDollar(a.totalPayment)}
                      <span style={{ color: TEXT_DIM, fontWeight: 400 }}> ({fmtDollar(a.principalPortion)} P + {fmtDollar(a.interestPortion)} I)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly Plan Table ─────────────────────────────────────── */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 12 }}>Monthly Plan (v23 Pro Forma)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, position: "sticky", left: 0, background: CARD }}>Metric</th>
                {monthlyRows.map((r) => (
                  <th
                    key={r.month}
                    style={{
                      textAlign: "right",
                      fontSize: 11,
                      color: r.isPast ? NAVY : TEXT_DIM,
                      paddingBottom: 8,
                      fontWeight: r.isPast ? 800 : 600,
                    }}
                  >
                    {r.label}
                  </th>
                ))}
                <th style={{ textAlign: "right", fontSize: 11, color: NAVY, paddingBottom: 8, fontWeight: 800 }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Units", key: "units" as const, format: (n: number) => n.toLocaleString(), total: ANNUAL_SUMMARY.totalUnits },
                { label: "Revenue", key: "revenue" as const, format: fmtDollar, total: ANNUAL_SUMMARY.totalRevenue },
                { label: "Gross Profit", key: "gp" as const, format: fmtDollar, total: ANNUAL_SUMMARY.totalGrossProfit },
                { label: "OpEx", key: "opex" as const, format: fmtDollar, total: ANNUAL_SUMMARY.totalOpex },
                { label: "EBITDA", key: "ebitda" as const, format: fmtDollar, total: ANNUAL_SUMMARY.ebitda },
                { label: "Loan Payment", key: "loanPayment" as const, format: fmtDollar, total: ANNUAL_SUMMARY.totalLoanRepayment2026 },
                { label: "Cash Balance", key: "cash" as const, format: fmtDollar, total: ANNUAL_SUMMARY.closingCashDec31 },
              ].map((row) => (
                <tr key={row.label}>
                  <td style={{ borderTop: `1px solid ${BORDER}`, padding: "7px 0", color: NAVY, fontWeight: 700, fontSize: 12, position: "sticky", left: 0, background: CARD }}>
                    {row.label}
                  </td>
                  {monthlyRows.map((m) => {
                    const val = m[row.key];
                    const isNegative = val < 0;
                    return (
                      <td
                        key={m.month}
                        style={{
                          borderTop: `1px solid ${BORDER}`,
                          padding: "7px 4px",
                          textAlign: "right",
                          fontSize: 12,
                          color: isNegative ? RED : (m.isPast ? NAVY : TEXT_DIM),
                          fontWeight: m.isPast ? 600 : 400,
                        }}
                      >
                        {row.format(val)}
                      </td>
                    );
                  })}
                  <td style={{ borderTop: `1px solid ${BORDER}`, padding: "7px 4px", textAlign: "right", fontSize: 12, color: row.total < 0 ? RED : NAVY, fontWeight: 800 }}>
                    {row.format(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Alerts (collapsible) ────────────────────────────────────── */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <button
          onClick={() => setAlertsOpen(!alertsOpen)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          <AlertTriangle size={16} color={NAVY} />
          <span style={{ fontWeight: 700, color: NAVY, flex: 1, textAlign: "left" }}>
            Alerts & Actions ({alerts?.summary.total || 0})
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {(alerts?.summary.critical || 0) > 0 && (
              <span style={{ background: RED, color: "#fff", borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                {alerts?.summary.critical} critical
              </span>
            )}
            {(alerts?.summary.warning || 0) > 0 && (
              <span style={{ background: GOLD, color: "#fff", borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                {alerts?.summary.warning} warning
              </span>
            )}
          </div>
          {alertsOpen ? <ChevronUp size={16} color={TEXT_DIM} /> : <ChevronDown size={16} color={TEXT_DIM} />}
        </button>

        {alertsOpen && (
          <div style={{ marginTop: 12 }}>
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
                      padding: "5px 10px",
                      fontSize: 11,
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

            {visibleAlerts.length === 0 ? (
              <div style={{ fontSize: 13, color: TEXT_DIM }}>
                {alertsLoading ? "Loading alerts..." : "No alerts in this filter."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {visibleAlerts.slice(0, 10).map((alert) => (
                  <div key={alert.id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: alert.priority === "critical" ? RED : alert.priority === "warning" ? GOLD : GREEN }} />
                        <span style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{alert.title}</span>
                      </div>
                      <div style={{ marginTop: 3, color: TEXT_DIM, fontSize: 12 }}>{alert.message}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => draftEmail(alert)}
                        style={{ border: "none", borderRadius: 6, background: NAVY, color: "#fff", padding: "5px 8px", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                      >
                        <Mail size={10} /> Email
                      </button>
                      <button
                        onClick={() => markDone(alert)}
                        style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, padding: "5px 8px", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                      >
                        <CheckCircle2 size={10} /> Done
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
