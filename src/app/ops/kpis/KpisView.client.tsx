"use client";

import { useMemo } from "react";

import {
  MONTHS,
  MONTH_LABELS,
  MONTH_FULL_LABELS,
  TOTAL_REVENUE,
  TOTAL_UNITS,
  TOTAL_GROSS_PROFIT,
  TOTAL_OPEX,
  EBITDA,
  LOAN,
  LOAN_REPAYMENT,
  ANNUAL_SUMMARY,
  AMAZON,
  WHOLESALE,
  DISTRIBUTOR,
  DISTRIBUTOR_NETWORK,
  UNIT_ECONOMICS,
  MILESTONES,
  getCurrentProFormaMonth,
  cumulativeThrough,
  type Month,
} from "@/lib/ops/pro-forma";

import {
  useDashboardData,
  usePnLData,
  useBalancesData,
  usePipelineData,
  comparePlanVsActual,
  fmtDollar,
  fmtPercent,
  fmtVariance,
  STATUS_COLORS,
  type PlanVsActual,
} from "@/lib/ops/use-war-room-data";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import {
  Target,
  DollarSign,
  Package,
  TrendingUp,
  CreditCard,
  Landmark,
  Calendar,
  BarChart3,
  Award,
  Layers,
  CheckCircle,
  AlertTriangle,
  Activity,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const CREAM = "#f8f5ef";
const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const WHITE = "#ffffff";
const LIGHT_GREEN = "#e6f5e6";
const LIGHT_RED = "#fde8e8";
const MUTED = "#7a8599";
const BORDER = "#e2ddd4";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt$(v: number): string {
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return "$" + (v / 1_000).toFixed(1) + "K";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtFull$(v: number): string {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtComma(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Computed data
// ---------------------------------------------------------------------------
function computeMonthlyGrid() {
  let cumulativeRevenue = 0;
  return MONTHS.map((m) => {
    const revenue = TOTAL_REVENUE[m];
    const units = TOTAL_UNITS[m];
    const cogs = units * UNIT_ECONOMICS.cogsPerBag;
    const gp = TOTAL_GROSS_PROFIT[m];
    const opex = TOTAL_OPEX[m];
    const ebitda = EBITDA[m];
    const loan = LOAN_REPAYMENT[m];
    cumulativeRevenue += revenue;
    return { month: m, label: MONTH_LABELS[m], revenue, units, cogs, gp, opex, ebitda, loan, cumulativeRevenue };
  });
}

function computeChannelComparison() {
  const channels = [
    { name: "Amazon", data: AMAZON, color: "#FF9900", gpPerUnit: UNIT_ECONOMICS.amazon.gpPerUnit },
    { name: "Wholesale", data: WHOLESALE, color: NAVY, gpPerUnit: UNIT_ECONOMICS.wholesale.gpPerUnit },
    { name: "Distributor", data: DISTRIBUTOR, color: GOLD, gpPerUnit: UNIT_ECONOMICS.distributor.gpPerUnit },
  ];

  const totalRev = ANNUAL_SUMMARY.totalRevenue;

  return channels.map((ch) => {
    const rev = MONTHS.reduce((s, m) => s + ch.data.revenue[m], 0);
    const units = MONTHS.reduce((s, m) => s + ch.data.units[m], 0);
    const gp = MONTHS.reduce((s, m) => s + ch.data.grossProfit[m], 0);
    return {
      name: ch.name,
      revenue: Math.round(rev),
      units,
      grossProfit: Math.round(gp),
      gpPerUnit: ch.gpPerUnit,
      revenueShare: rev / totalRev,
      color: ch.color,
    };
  });
}

function findPeakMonth(): { month: string; value: number } {
  let peak = 0;
  let peakM: Month = "mar";
  for (const m of MONTHS) {
    if (TOTAL_REVENUE[m] > peak) {
      peak = TOTAL_REVENUE[m];
      peakM = m;
    }
  }
  return { month: MONTH_FULL_LABELS[peakM], value: peak };
}

// ---------------------------------------------------------------------------
// Shimmer loader for sections
// ---------------------------------------------------------------------------
function Shimmer({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        background: `linear-gradient(90deg, ${BORDER}00 0%, ${BORDER} 50%, ${BORDER}00 100%)`,
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Traffic Light KPI Card (with live data)
// ---------------------------------------------------------------------------
function LiveKpiCard({
  icon,
  title,
  planValue,
  planLabel,
  pva,
  loading,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  planValue: string;
  planLabel: string;
  pva: PlanVsActual | null;
  loading: boolean;
  error: string | null;
}) {
  const hasLive = pva && pva.status !== "no-data";
  const statusColor = pva ? STATUS_COLORS[pva.status] : MUTED;
  const isPositive = pva ? pva.variance >= 0 : false;

  return (
    <div
      style={{
        background: WHITE,
        borderRadius: 12,
        padding: "20px 22px",
        boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
        border: `1px solid ${BORDER}`,
        flex: "1 1 180px",
        minWidth: 190,
        position: "relative",
        borderTop: hasLive ? `3px solid ${statusColor}` : `3px solid ${BORDER}`,
      }}
    >
      {/* Traffic light indicator */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: loading ? MUTED : statusColor,
          boxShadow: loading ? "none" : `0 0 8px ${statusColor}60`,
          transition: "background 0.3s, box-shadow 0.3s",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `${NAVY}0D`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {title}
        </span>
      </div>

      {/* Actual value (bold, primary) or loading state */}
      {loading ? (
        <Shimmer width={100} height={28} />
      ) : hasLive ? (
        <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 2, fontFamily: "system-ui" }}>
          {fmtDollar(pva!.actual)}
        </div>
      ) : (
        <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 2, fontFamily: "system-ui" }}>
          {planValue}
        </div>
      )}

      {/* Plan reference */}
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
        Plan: {planValue}
      </div>

      {/* Variance badge */}
      {loading ? (
        <Shimmer width={80} height={18} />
      ) : hasLive && pva ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 700,
            color: isPositive ? "#16a34a" : RED,
            background: isPositive ? LIGHT_GREEN : LIGHT_RED,
            borderRadius: 4,
            padding: "3px 10px",
            letterSpacing: "0.02em",
          }}
        >
          {isPositive ? "+" : ""}{(pva.variancePct * 100).toFixed(1)}% vs plan
        </div>
      ) : error ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: GOLD,
            background: `${GOLD}14`,
            borderRadius: 4,
            padding: "2px 8px",
          }}
        >
          <AlertTriangle size={10} />
          No live data
        </div>
      ) : (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: GOLD,
            background: `${GOLD}14`,
            borderRadius: 4,
            padding: "2px 8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          <Target size={10} />
          {planLabel}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Original plan-only KpiCard (kept for non-traffic-light cards)
// ---------------------------------------------------------------------------
function KpiCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        background: WHITE,
        borderRadius: 12,
        padding: "20px 22px",
        boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
        border: `1px solid ${BORDER}`,
        flex: "1 1 180px",
        minWidth: 170,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `${NAVY}0D`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {title}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 4, fontFamily: "system-ui" }}>
        {value}
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          fontWeight: 600,
          color: GOLD,
          background: `${GOLD}14`,
          borderRadius: 4,
          padding: "2px 8px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <Target size={10} />
        {subtitle}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function KpisView() {
  const grid = computeMonthlyGrid();
  const channels = computeChannelComparison();
  const peak = findPeakMonth();
  const blendedGM = ANNUAL_SUMMARY.blendedGrossMargin;

  // ── Live data hooks ──────────────────────────────────────────────────────
  const { data: dashboard, loading: dashLoading, error: dashError } = useDashboardData();
  const { data: pnl, loading: pnlLoading, error: pnlError } = usePnLData();
  const { data: balances, loading: balLoading, error: balError } = useBalancesData();
  const { data: pipeline, loading: pipeLoading, error: pipeError } = usePipelineData();

  const anyLoading = dashLoading || pnlLoading || balLoading || pipeLoading;
  const anyLive = !!(dashboard || pnl || balances || pipeline);

  // ── Current month context ────────────────────────────────────────────────
  const currentMonth = getCurrentProFormaMonth();
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = dayOfMonth / daysInMonth;

  // ── Plan vs Actual comparisons (MTD targets prorated) ────────────────────
  const mtdPlanRevenue = currentMonth ? cumulativeThrough(TOTAL_REVENUE, currentMonth) : 0;
  const mtdPlanOrders = currentMonth ? cumulativeThrough(TOTAL_UNITS, currentMonth) : 0;

  const revenuePva = useMemo(
    () => comparePlanVsActual(mtdPlanRevenue, dashboard?.combined?.totalRevenue),
    [dashboard, mtdPlanRevenue]
  );
  const ordersPva = useMemo(
    () => comparePlanVsActual(mtdPlanOrders, dashboard?.combined?.totalOrders),
    [dashboard, mtdPlanOrders]
  );
  const marginPva = useMemo(
    () => comparePlanVsActual(blendedGM, pnl?.grossMargin),
    [pnl, blendedGM]
  );
  const cashPva = useMemo(
    () => comparePlanVsActual(ANNUAL_SUMMARY.closingCashDec31, balances?.totalCash),
    [balances]
  );
  const pipelinePva = useMemo(
    () => comparePlanVsActual(100000, pipeline?.pipelineValue?.total),
    [pipeline]
  );

  // ── Run Rate Projections ─────────────────────────────────────────────────
  const actualMtdRevenue = dashboard?.combined?.totalRevenue ?? 0;
  const actualMtdOrders = dashboard?.combined?.totalOrders ?? 0;
  const projectedMonthRevenue = monthProgress > 0 ? actualMtdRevenue / monthProgress : 0;
  const projectedMonthOrders = monthProgress > 0 ? actualMtdOrders / monthProgress : 0;
  const currentMonthPlanRevenue = currentMonth ? TOTAL_REVENUE[currentMonth] : 0;
  const currentMonthPlanOrders = currentMonth ? TOTAL_UNITS[currentMonth] : 0;
  const runRateRevenueVsPlan = currentMonthPlanRevenue > 0
    ? (projectedMonthRevenue - currentMonthPlanRevenue) / currentMonthPlanRevenue
    : 0;
  const runRateOrdersVsPlan = currentMonthPlanOrders > 0
    ? (projectedMonthOrders - currentMonthPlanOrders) / currentMonthPlanOrders
    : 0;

  // Annualized run rate from this month's pace
  const annualizedRevenue = projectedMonthRevenue * 12;

  // ── Milestone achievement check ──────────────────────────────────────────
  function getMilestoneStatus(milestone: typeof MILESTONES[0]): "achieved" | "in-progress" | "behind" | "upcoming" {
    if (!currentMonth) return "upcoming";
    const monthIdx = MONTHS.indexOf(currentMonth);
    const targetIdx = typeof milestone.targetMonth === "string" ? MONTHS.indexOf(milestone.targetMonth as Month) : -1;

    // Not yet reached the target month
    if (targetIdx >= 0 && monthIdx < targetIdx) return "upcoming";

    // Check if metric is achieved based on live data
    switch (milestone.metric) {
      case "ebitda":
        if (pnl?.netIncome != null && pnl.netIncome > milestone.threshold) return "achieved";
        if (monthIdx >= targetIdx) return "behind";
        return "in-progress";
      case "cash":
        if (balances?.totalCash != null && balances.totalCash >= milestone.threshold) return "achieved";
        if (monthIdx >= targetIdx) return "behind";
        return "in-progress";
      case "cumulative_units":
        if (dashboard?.combined?.totalOrders != null && dashboard.combined.totalOrders >= milestone.threshold) return "achieved";
        return "in-progress";
      default:
        // For distributor milestones and others, check if we've passed target month
        if (monthIdx >= targetIdx) return "in-progress";
        return "upcoming";
    }
  }

  // Totals for the grid
  const totals = grid.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      units: acc.units + r.units,
      cogs: acc.cogs + r.cogs,
      gp: acc.gp + r.gp,
      opex: acc.opex + r.opex,
      ebitda: acc.ebitda + r.ebitda,
      loan: acc.loan + r.loan,
    }),
    { revenue: 0, units: 0, cogs: 0, gp: 0, opex: 0, ebitda: 0, loan: 0 }
  );

  // Channel bar chart data
  const channelBarData = [
    {
      metric: "Revenue",
      Amazon: channels[0].revenue,
      Wholesale: channels[1].revenue,
      Distributor: channels[2].revenue,
    },
    {
      metric: "Units",
      Amazon: channels[0].units,
      Wholesale: channels[1].units,
      Distributor: channels[2].units,
    },
    {
      metric: "Gross Profit",
      Amazon: channels[0].grossProfit,
      Wholesale: channels[1].grossProfit,
      Distributor: channels[2].grossProfit,
    },
  ];

  // Milestones timeline data (enhanced with live status)
  const timelineItems = [
    { month: "Mar", label: "Launch", highlight: true, description: "First shipments, Amazon live", milestoneId: null },
    { month: "May", label: "Distributor #1", highlight: false, description: "Brent Inderbitzin live", milestoneId: "first-distributor" },
    { month: "Jun", label: "EBITDA Positive", highlight: true, description: "Month 4 profitability", milestoneId: "ebitda-positive" },
    { month: "Aug", label: "Loan Repayment", highlight: false, description: "15% revenue begins", milestoneId: "loan-repayment-start" },
    { month: "Aug", label: "Distributor #2", highlight: false, description: "Second territory", milestoneId: "second-distributor" },
    { month: "Nov", label: "Distributor #3", highlight: false, description: "Third territory", milestoneId: "third-distributor" },
    { month: "Dec", label: "Year 1 Complete", highlight: true, description: "108K+ units shipped", milestoneId: "100k-units" },
    { month: "Feb '28", label: "Loan Repaid", highlight: true, description: "$324K fully repaid", milestoneId: null },
  ];

  const sectionHeading = (_text: string) => ({
    fontSize: 16,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 16,
    marginTop: 40,
    paddingBottom: 8,
    borderBottom: `2px solid ${GOLD}`,
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
  });

  return (
    <div style={{ background: CREAM, minHeight: "100vh", padding: "32px 24px", fontFamily: "system-ui, sans-serif" }}>
      {/* Shimmer keyframes */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* == HEADER ================================================ */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: NAVY,
              margin: 0,
              letterSpacing: "-0.02em",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            Scoreboard
            {/* LIVE indicator */}
            {anyLive && !anyLoading && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#16a34a",
                  background: LIGHT_GREEN,
                  borderRadius: 20,
                  padding: "4px 12px",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#16a34a",
                    display: "inline-block",
                    animation: "pulse-live 2s ease-in-out infinite",
                  }}
                />
                LIVE
              </span>
            )}
            {anyLoading && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  color: MUTED,
                  background: `${MUTED}18`,
                  borderRadius: 20,
                  padding: "4px 12px",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                <Activity size={12} />
                Loading...
              </span>
            )}
          </h1>
          <p style={{ fontSize: 14, color: MUTED, margin: "6px 0 0 0" }}>
            Key Performance Indicators &mdash; Plan Targets vs Live Actuals &middot; Year 1 (March&ndash;December 2026)
          </p>
        </div>
        {/* Error warnings */}
        {(dashError || pnlError || balError || pipeError) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: GOLD,
              background: `${GOLD}14`,
              borderRadius: 8,
              padding: "6px 14px",
              border: `1px solid ${GOLD}40`,
            }}
          >
            <AlertTriangle size={14} color={GOLD} />
            Some live data unavailable -- showing plan data as fallback
          </div>
        )}
      </div>

      {/* == LIVE PERFORMANCE BANNER =============================== */}
      <div
        style={{
          background: anyLive && !anyLoading
            ? `linear-gradient(135deg, ${NAVY} 0%, #2a3f6e 100%)`
            : `linear-gradient(135deg, ${MUTED}40 0%, ${MUTED}25 100%)`,
          borderRadius: 12,
          padding: "18px 24px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          border: anyLive && !anyLoading ? "none" : `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {anyLoading ? (
            <Activity size={20} color={MUTED} style={{ animation: "pulse-live 1.5s ease-in-out infinite" }} />
          ) : anyLive ? (
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#16a34a",
                boxShadow: "0 0 8px #16a34a60",
                animation: "pulse-live 2s ease-in-out infinite",
              }}
            />
          ) : null}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: anyLive && !anyLoading ? WHITE : MUTED,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {anyLoading ? "Loading Live Data..." : anyLive ? "Live Performance" : "Plan Mode"}
            </div>
            <div style={{ fontSize: 11, color: anyLive && !anyLoading ? "#b8c4db" : MUTED, marginTop: 2 }}>
              {anyLive && !anyLoading
                ? `Updated ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                : "Awaiting live data from APIs"}
            </div>
          </div>
        </div>

        {/* Quick summary stats */}
        {anyLive && !anyLoading && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#b8c4db", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                MTD Revenue
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: WHITE }}>
                {dashboard ? fmt$(dashboard.combined.totalRevenue) : "--"}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#b8c4db", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Orders
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: WHITE }}>
                {dashboard ? fmtComma(dashboard.combined.totalOrders) : "--"}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#b8c4db", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                AOV
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: WHITE }}>
                {dashboard?.combined?.avgOrderValue ? fmt$(dashboard.combined.avgOrderValue) : "--"}
              </div>
            </div>
            {pnl && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#b8c4db", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Gross Margin
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: pnl.grossMargin >= 0.25 ? "#86efac" : "#fca5a5" }}>
                  {fmtPct(pnl.grossMargin)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading shimmer for stats */}
        {anyLoading && (
          <div style={{ display: "flex", gap: 24 }}>
            <Shimmer width={80} height={32} />
            <Shimmer width={60} height={32} />
            <Shimmer width={60} height={32} />
          </div>
        )}
      </div>

      {/* == 1. TRAFFIC LIGHT KPIs ================================= */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 8 }}>
        <LiveKpiCard
          icon={<DollarSign size={18} color={NAVY} />}
          title="Revenue (MTD)"
          planValue={fmt$(mtdPlanRevenue)}
          planLabel="Cumul. Plan Target"
          pva={revenuePva}
          loading={dashLoading}
          error={dashError}
        />
        <LiveKpiCard
          icon={<Package size={18} color={NAVY} />}
          title="Orders (MTD)"
          planValue={fmtComma(mtdPlanOrders)}
          planLabel="Cumul. Plan Target"
          pva={ordersPva}
          loading={dashLoading}
          error={dashError}
        />
        <LiveKpiCard
          icon={<BarChart3 size={18} color={NAVY} />}
          title="Gross Margin"
          planValue={fmtPct(blendedGM)}
          planLabel="Blended Target"
          pva={marginPva}
          loading={pnlLoading}
          error={pnlError}
        />
        <LiveKpiCard
          icon={<Landmark size={18} color={NAVY} />}
          title="Cash Position"
          planValue={fmt$(ANNUAL_SUMMARY.closingCashDec31)}
          planLabel="Year-End Target"
          pva={cashPva}
          loading={balLoading}
          error={balError}
        />
        <LiveKpiCard
          icon={<TrendingUp size={18} color={NAVY} />}
          title="Pipeline Value"
          planValue="$100K"
          planLabel="Target"
          pva={pipelinePva}
          loading={pipeLoading}
          error={pipeError}
        />
        <KpiCard
          icon={<CreditCard size={18} color={NAVY} />}
          title="Loan Repayment"
          value="Feb 2028"
          subtitle="Projected Payoff"
        />
      </div>

      {/* == 2. RUN RATE PROJECTION ================================ */}
      {anyLive && !anyLoading && (
        <>
          <div style={sectionHeading("")}>
            <Zap size={18} color={GOLD} />
            <span>Run Rate Projection</span>
            {currentMonth && (
              <span style={{ fontSize: 11, fontWeight: 400, color: MUTED, marginLeft: "auto" }}>
                {MONTH_FULL_LABELS[currentMonth]} &middot; Day {dayOfMonth} of {daysInMonth} ({(monthProgress * 100).toFixed(0)}% elapsed)
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 8 }}>
            {/* Projected Month Revenue */}
            <div
              style={{
                background: WHITE,
                borderRadius: 12,
                padding: "20px 24px",
                boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
                border: `1px solid ${BORDER}`,
                flex: "1 1 220px",
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                Projected Month Revenue
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                {fmt$(projectedMonthRevenue)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                Plan: {fmt$(currentMonthPlanRevenue)}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: runRateRevenueVsPlan >= 0 ? "#16a34a" : RED,
                  background: runRateRevenueVsPlan >= 0 ? LIGHT_GREEN : LIGHT_RED,
                  borderRadius: 6,
                  padding: "4px 12px",
                }}
              >
                {runRateRevenueVsPlan >= 0 ? "+" : ""}{(runRateRevenueVsPlan * 100).toFixed(1)}% vs plan
              </div>
            </div>

            {/* Projected Month Orders */}
            <div
              style={{
                background: WHITE,
                borderRadius: 12,
                padding: "20px 24px",
                boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
                border: `1px solid ${BORDER}`,
                flex: "1 1 220px",
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                Projected Month Orders
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                {fmtComma(Math.round(projectedMonthOrders))}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                Plan: {fmtComma(currentMonthPlanOrders)}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: runRateOrdersVsPlan >= 0 ? "#16a34a" : RED,
                  background: runRateOrdersVsPlan >= 0 ? LIGHT_GREEN : LIGHT_RED,
                  borderRadius: 6,
                  padding: "4px 12px",
                }}
              >
                {runRateOrdersVsPlan >= 0 ? "+" : ""}{(runRateOrdersVsPlan * 100).toFixed(1)}% vs plan
              </div>
            </div>

            {/* MTD Actuals */}
            <div
              style={{
                background: WHITE,
                borderRadius: 12,
                padding: "20px 24px",
                boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
                border: `1px solid ${BORDER}`,
                flex: "1 1 220px",
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                MTD Actual Revenue
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                {fmt$(actualMtdRevenue)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                {fmtComma(actualMtdOrders)} orders &middot; AOV {dashboard?.combined?.avgOrderValue ? fmt$(dashboard.combined.avgOrderValue) : "--"}
              </div>
              {/* Progress bar */}
              <div style={{ background: "#eee8dd", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(monthProgress * 100, 100)}%`,
                    height: "100%",
                    background: `linear-gradient(to right, ${GOLD}, ${NAVY})`,
                    borderRadius: 4,
                    transition: "width 0.5s",
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                Month progress
              </div>
            </div>

            {/* Annualized Run Rate */}
            <div
              style={{
                background: WHITE,
                borderRadius: 12,
                padding: "20px 24px",
                boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
                border: `1px solid ${BORDER}`,
                flex: "1 1 220px",
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                Annualized Run Rate
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                {fmt$(annualizedRevenue)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                Plan: {fmt$(ANNUAL_SUMMARY.totalRevenue)}
              </div>
              {annualizedRevenue > 0 && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    color: annualizedRevenue >= ANNUAL_SUMMARY.totalRevenue ? "#16a34a" : RED,
                    background: annualizedRevenue >= ANNUAL_SUMMARY.totalRevenue ? LIGHT_GREEN : LIGHT_RED,
                    borderRadius: 6,
                    padding: "4px 12px",
                  }}
                >
                  {annualizedRevenue >= ANNUAL_SUMMARY.totalRevenue ? "Ahead" : "Behind"} annual plan
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* == 3. MONTHLY TARGET GRID ================================ */}
      <div style={sectionHeading("")}>
        <Calendar size={18} color={GOLD} />
        <span>Monthly Target Grid</span>
      </div>
      <div
        style={{
          overflowX: "auto",
          background: WHITE,
          borderRadius: 12,
          boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
          border: `1px solid ${BORDER}`,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            minWidth: 900,
          }}
        >
          <thead>
            <tr style={{ background: NAVY }}>
              {["Month", "Revenue", "Units", "COGS", "Gross Profit", "OpEx", "EBITDA", "Loan Pmt", "Cumul. Rev"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      padding: "12px 14px",
                      textAlign: h === "Month" ? "left" : "right",
                      color: WHITE,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {/* MTD ACTUAL row — pinned to TOP of grid */}
            {anyLive && currentMonth && (
              <tr
                style={{
                  background: `linear-gradient(90deg, #eaf3fb 0%, #f5f0e4 100%)`,
                  fontWeight: 700,
                  fontSize: 13,
                  borderBottom: `2px solid ${GOLD}`,
                }}
              >
                <td style={{ padding: "12px 14px", color: NAVY }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#16a34a",
                        display: "inline-block",
                        animation: "pulse-live 2s ease-in-out infinite",
                      }}
                    />
                    MTD ACTUAL
                  </span>
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: NAVY, fontWeight: 800 }}>
                  {dashboard ? fmtFull$(dashboard.combined.totalRevenue) : "--"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: NAVY, fontWeight: 800 }}>
                  {dashboard ? fmtComma(dashboard.combined.totalOrders) : "--"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: MUTED }}>
                  {pnl ? fmtFull$(pnl.cogs.total) : "--"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: NAVY, fontWeight: 800 }}>
                  {pnl ? fmtFull$(pnl.grossProfit) : "--"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: RED }}>
                  {pnl ? fmtFull$(pnl.opex.total) : "--"}
                </td>
                <td
                  style={{
                    padding: "12px 14px",
                    textAlign: "right",
                    fontWeight: 800,
                    background: pnl && pnl.netIncome >= 0 ? LIGHT_GREEN : LIGHT_RED,
                    color: pnl && pnl.netIncome >= 0 ? "#16a34a" : RED,
                  }}
                >
                  {pnl ? fmtFull$(pnl.netIncome) : "--"}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: MUTED }}>--</td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: NAVY, fontWeight: 800 }}>
                  {dashboard ? fmtFull$(dashboard.combined.totalRevenue) : "--"}
                </td>
              </tr>
            )}

            {grid.map((r, i) => {
              const isEbitdaPositive = r.ebitda > 0;
              const isFirstPositive = r.month === "jun";
              const isCurrentMonth = r.month === currentMonth;
              return (
                <tr
                  key={r.month}
                  style={{
                    background: isCurrentMonth
                      ? `${NAVY}0A`
                      : isFirstPositive
                      ? `${GOLD}18`
                      : i % 2 === 0
                      ? WHITE
                      : "#faf8f4",
                    fontWeight: isFirstPositive ? 700 : 400,
                    borderLeft: isCurrentMonth
                      ? `3px solid ${NAVY}`
                      : isFirstPositive
                      ? `3px solid ${GOLD}`
                      : "3px solid transparent",
                  }}
                >
                  <td style={{ padding: "10px 14px", color: NAVY, fontWeight: 600 }}>
                    {MONTH_FULL_LABELS[r.month]}
                    {isFirstPositive && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 9,
                          background: "#16a34a",
                          color: WHITE,
                          borderRadius: 3,
                          padding: "1px 6px",
                          fontWeight: 700,
                          verticalAlign: "middle",
                        }}
                      >
                        EBITDA+
                      </span>
                    )}
                    {isCurrentMonth && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 9,
                          background: NAVY,
                          color: WHITE,
                          borderRadius: 3,
                          padding: "1px 6px",
                          fontWeight: 700,
                          verticalAlign: "middle",
                        }}
                      >
                        NOW
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: NAVY }}>{fmtFull$(r.revenue)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: NAVY }}>{fmtComma(r.units)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: MUTED }}>{fmtFull$(r.cogs)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: NAVY }}>{fmtFull$(r.gp)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: RED }}>{fmtFull$(r.opex)}</td>
                  <td
                    style={{
                      padding: "10px 14px",
                      textAlign: "right",
                      fontWeight: 600,
                      background: isEbitdaPositive ? LIGHT_GREEN : LIGHT_RED,
                      color: isEbitdaPositive ? "#16a34a" : RED,
                    }}
                  >
                    {fmtFull$(r.ebitda)}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: r.loan > 0 ? NAVY : MUTED }}>
                    {r.loan > 0 ? fmtFull$(r.loan) : "--"}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: NAVY, fontWeight: 500 }}>
                    {fmtFull$(r.cumulativeRevenue)}
                  </td>
                </tr>
              );
            })}

            {/* TOTAL row */}
            <tr
              style={{
                background: NAVY,
                color: WHITE,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <td style={{ padding: "12px 14px" }}>TOTAL (PLAN)</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.revenue)}</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtComma(totals.units)}</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.cogs)}</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.gp)}</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.opex)}</td>
              <td
                style={{
                  padding: "12px 14px",
                  textAlign: "right",
                  color: totals.ebitda >= 0 ? "#86efac" : "#fca5a5",
                }}
              >
                {fmtFull$(totals.ebitda)}
              </td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.loan)}</td>
              <td style={{ padding: "12px 14px", textAlign: "right" }}>{fmtFull$(totals.revenue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* == 4. MILESTONE TRACKER ================================== */}
      <div style={sectionHeading("")}>
        <Award size={18} color={GOLD} />
        <span>Milestone Tracker</span>
      </div>
      <div
        style={{
          background: WHITE,
          borderRadius: 12,
          boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
          border: `1px solid ${BORDER}`,
          padding: "28px 24px",
          overflowX: "auto",
        }}
      >
        {/* Timeline */}
        <div style={{ position: "relative", minWidth: 700 }}>
          {/* Connecting line */}
          <div
            style={{
              position: "absolute",
              top: 20,
              left: 20,
              right: 20,
              height: 3,
              background: `linear-gradient(to right, ${NAVY}, ${GOLD})`,
              borderRadius: 2,
              zIndex: 0,
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              position: "relative",
              zIndex: 1,
            }}
          >
            {timelineItems.map((item, idx) => {
              // Determine milestone status from live data
              const milestone = item.milestoneId ? MILESTONES.find((m) => m.id === item.milestoneId) : null;
              const status = milestone ? getMilestoneStatus(milestone) : (item.highlight ? "upcoming" : "upcoming");
              const dotColor =
                status === "achieved" ? "#16a34a" :
                status === "in-progress" ? GOLD :
                status === "behind" ? RED :
                item.highlight ? RED : NAVY;
              const dotSize = item.highlight ? 28 : 18;

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flex: "1 1 0",
                    minWidth: 80,
                  }}
                >
                  {/* Dot */}
                  <div
                    style={{
                      width: dotSize,
                      height: dotSize,
                      borderRadius: "50%",
                      background: dotColor,
                      border: `3px solid ${WHITE}`,
                      boxShadow: `0 0 0 ${item.highlight ? 3 : 2}px ${dotColor}40, 0 2px 8px rgba(0,0,0,0.15)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 10,
                      transition: "background 0.3s",
                    }}
                  >
                    {status === "achieved" && <CheckCircle size={12} color={WHITE} />}
                    {item.highlight && status !== "achieved" && <CheckCircle size={12} color={WHITE} />}
                  </div>
                  {/* Month badge */}
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: WHITE,
                      background: dotColor,
                      borderRadius: 4,
                      padding: "2px 8px",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {item.month}
                  </div>
                  {/* Label */}
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: NAVY,
                      textAlign: "center",
                      marginBottom: 2,
                    }}
                  >
                    {item.label}
                  </div>
                  {/* Description */}
                  <div
                    style={{
                      fontSize: 10,
                      color: MUTED,
                      textAlign: "center",
                      lineHeight: 1.3,
                    }}
                  >
                    {item.description}
                  </div>
                  {/* Status badge for live milestones */}
                  {milestone && anyLive && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        color: WHITE,
                        background:
                          status === "achieved" ? "#16a34a" :
                          status === "in-progress" ? GOLD :
                          status === "behind" ? RED : MUTED,
                        borderRadius: 3,
                        padding: "1px 6px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {status === "achieved" ? "Done" :
                       status === "in-progress" ? "In Progress" :
                       status === "behind" ? "Behind" : "Upcoming"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* == 5. ANNUAL PROJECTION SUMMARY ========================== */}
      <div style={sectionHeading("")}>
        <Layers size={18} color={GOLD} />
        <span>Annual Projection Summary</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {/* Revenue Projection */}
        <div
          style={{
            background: WHITE,
            borderRadius: 12,
            boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
            border: `1px solid ${BORDER}`,
            padding: "22px 24px",
            flex: "1 1 260px",
            minWidth: 250,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Revenue Projection
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: NAVY, marginBottom: 16 }}>
            {fmt$(ANNUAL_SUMMARY.totalRevenue)}
          </div>
          {/* Channel breakdown bars */}
          {channels.map((ch) => {
            const pct = (ch.revenue / ANNUAL_SUMMARY.totalRevenue) * 100;
            return (
              <div key={ch.name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: NAVY, fontWeight: 600 }}>{ch.name}</span>
                  <span style={{ color: MUTED }}>{fmt$(ch.revenue)} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ background: "#eee8dd", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: ch.color,
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            );
          })}
          {/* Live run-rate projection */}
          {anyLive && !anyLoading && (
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: MUTED }}>MTD Actual Revenue</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>
                  {dashboard ? fmt$(dashboard.combined.totalRevenue) : "--"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: MUTED }}>Run Rate Projection</span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: projectedMonthRevenue * 10 >= ANNUAL_SUMMARY.totalRevenue ? "#16a34a" : GOLD,
                  }}
                >
                  On pace for {fmt$(projectedMonthRevenue * 10)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Profitability Path */}
        <div
          style={{
            background: WHITE,
            borderRadius: 12,
            boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
            border: `1px solid ${BORDER}`,
            padding: "22px 24px",
            flex: "1 1 260px",
            minWidth: 250,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Profitability Path
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#16a34a", marginBottom: 16 }}>
            Month 4
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Months to EBITDA Positive</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>
                4 <span style={{ fontSize: 12, fontWeight: 400, color: MUTED }}>(June 2026)</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Annual EBITDA (Year 1)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: RED }}>{fmtFull$(ANNUAL_SUMMARY.ebitda)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>EBITDA Margin (steady state H2)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>
                {((
                  (EBITDA.aug + EBITDA.sep + EBITDA.oct + EBITDA.nov + EBITDA.dec) /
                  (TOTAL_REVENUE.aug + TOTAL_REVENUE.sep + TOTAL_REVENUE.oct + TOTAL_REVENUE.nov + TOTAL_REVENUE.dec)
                ) * 100).toFixed(1)}
                %
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Months EBITDA Positive (Year 1)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>
                {MONTHS.filter((m) => EBITDA[m] > 0).length} of 10
              </div>
            </div>
            {/* Live P&L snapshot */}
            {pnl && (
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Current Net Income (MTD)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: pnl.netIncome >= 0 ? "#16a34a" : RED }}>
                  {fmtFull$(pnl.netIncome)}
                  <span style={{ fontSize: 11, fontWeight: 400, color: MUTED, marginLeft: 6 }}>
                    ({fmtPct(pnl.netMargin)} margin)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loan Obligation */}
        <div
          style={{
            background: WHITE,
            borderRadius: 12,
            boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
            border: `1px solid ${BORDER}`,
            padding: "22px 24px",
            flex: "1 1 260px",
            minWidth: 250,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Loan Obligation
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: NAVY, marginBottom: 16 }}>{fmt$(LOAN.totalObligation)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Principal</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{fmt$(LOAN.principal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Interest (8% flat)</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{fmt$(LOAN.totalObligation - LOAN.principal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Monthly Payment</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>15% of revenue</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Deferral Period</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{LOAN.deferralMonths} months</span>
            </div>
            <div
              style={{
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>Projected Payoff</span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: WHITE,
                  background: "#16a34a",
                  borderRadius: 4,
                  padding: "3px 10px",
                }}
              >
                {LOAN.projectedPayoffDate}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Repaid by Dec 2026</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{fmt$(ANNUAL_SUMMARY.totalLoanRepayment2026)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Balance Dec 31</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: RED }}>{fmt$(ANNUAL_SUMMARY.loanBalanceDec31)}</span>
            </div>
          </div>
        </div>

        {/* Growth Metrics */}
        <div
          style={{
            background: WHITE,
            borderRadius: 12,
            boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
            border: `1px solid ${BORDER}`,
            padding: "22px 24px",
            flex: "1 1 260px",
            minWidth: 250,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Growth Metrics
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: NAVY, marginBottom: 16 }}>
            {fmtComma(ANNUAL_SUMMARY.totalUnits)}
            <span style={{ fontSize: 14, fontWeight: 400, color: MUTED, marginLeft: 6 }}>units</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Peak Monthly Revenue</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                {fmt$(peak.value)} <span style={{ fontSize: 10, color: MUTED }}>({peak.month})</span>
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Sales Channels</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>3</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Distributor Target</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                {DISTRIBUTOR_NETWORK.length} reps
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Confirmed Distributors</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>
                {DISTRIBUTOR_NETWORK.filter((d) => d.status === "confirmed").length}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Revenue Growth (Mar{"\u2192"}Dec)</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>
                {((TOTAL_REVENUE.dec / TOTAL_REVENUE.mar - 1) * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: MUTED }}>Unit Growth (Mar{"\u2192"}Dec)</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>
                {((TOTAL_UNITS.dec / TOTAL_UNITS.mar - 1) * 100).toFixed(0)}%
              </span>
            </div>
            {/* Live pipeline snapshot */}
            {pipeline && (
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: MUTED }}>Live Pipeline Leads</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{pipeline.totalLeads}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>Pipeline Value</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>{fmt$(pipeline.pipelineValue.total)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* == 6. CHANNEL KPI COMPARISON ============================= */}
      <div style={sectionHeading("")}>
        <BarChart3 size={18} color={GOLD} />
        <span>Channel KPI Comparison</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {/* Bar Chart */}
        <div
          style={{
            background: WHITE,
            borderRadius: 12,
            boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
            border: `1px solid ${BORDER}`,
            padding: "22px 24px",
            flex: "2 1 500px",
            minWidth: 340,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", marginBottom: 16 }}>
            Revenue &amp; Gross Profit by Channel (Annual)
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={channelBarData} barGap={4} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="metric" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: BORDER }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt$(v)} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={((value: number) => fmtFull$(value)) as any}
                contentStyle={{
                  background: NAVY,
                  border: "none",
                  borderRadius: 8,
                  color: WHITE,
                  fontSize: 12,
                }}
                labelStyle={{ color: GOLD, fontWeight: 600, marginBottom: 4 }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
              <Bar dataKey="Amazon" fill="#FF9900" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Wholesale" fill={NAVY} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Distributor" fill={GOLD} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Channel detail cards */}
        <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 14, minWidth: 250 }}>
          {channels.map((ch) => (
            <div
              key={ch.name}
              style={{
                background: WHITE,
                borderRadius: 12,
                boxShadow: "0 1px 4px rgba(27,42,74,0.08)",
                border: `1px solid ${BORDER}`,
                padding: "16px 20px",
                borderLeft: `4px solid ${ch.color}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{ch.name}</span>
                <span style={{ fontSize: 11, color: MUTED }}>{(ch.revenueShare * 100).toFixed(0)}% of revenue</span>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase" }}>Revenue</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{fmt$(ch.revenue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase" }}>Units</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{fmtComma(ch.units)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase" }}>GP / Unit</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>${ch.gpPerUnit.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: "uppercase" }}>Gross Profit</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{fmt$(ch.grossProfit)}</div>
                </div>
              </div>
              {/* Live channel revenue from dashboard */}
              {dashboard && ch.name === "Amazon" && dashboard.amazon && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}`, display: "flex", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase" }}>Live MTD Rev</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                      {fmt$(dashboard.amazon.revenue?.["30d"] ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase" }}>Live MTD Orders</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                      {fmtComma(dashboard.amazon.orders?.["30d"] ?? 0)}
                    </div>
                  </div>
                </div>
              )}
              {dashboard && ch.name !== "Amazon" && dashboard.shopify && ch.name === "Wholesale" && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}`, display: "flex", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase" }}>Shopify MTD Rev</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                      {fmt$(dashboard.shopify.totalRevenue)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: MUTED, textTransform: "uppercase" }}>Shopify Orders</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                      {fmtComma(dashboard.shopify.totalOrders)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          marginTop: 48,
          paddingTop: 20,
          borderTop: `1px solid ${BORDER}`,
          fontSize: 11,
          color: MUTED,
        }}
      >
        USA Gummies Inc. &mdash; Pro Forma Year 1 KPI Scoreboard &mdash; Confidential
        {anyLive && (
          <span style={{ marginLeft: 12, color: "#16a34a" }}>
            Live data as of {new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}
