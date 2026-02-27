"use client";

import { useMemo } from "react";
import type { LucideProps } from "lucide-react";
import {
  useDashboardData,
  useBalancesData,
  comparePlanVsActual,
  fmtDollar as liveFmtDollar,
  fmtVariance,
  STATUS_COLORS,
  type PlanVsActual,
} from "@/lib/ops/use-war-room-data";
import {
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from "recharts";
import {
  DollarSign,
  Package,
  TrendingUp,
  Landmark,
  BarChart3,
  Wallet,
  ShoppingCart,
  Truck,
  Store,
  Flag,
  CheckCircle,
  Target,
  RefreshCw,
  AlertTriangle,
  Activity,
} from "lucide-react";

import {
  MONTHS,
  MONTH_LABELS,
  MONTH_FULL_LABELS,
  TOTAL_REVENUE,
  EBITDA,
  LOAN,
  AMAZON,
  WHOLESALE,
  DISTRIBUTOR,
  ANNUAL_SUMMARY,
  CAPITAL_DEPLOYMENT,
  TOTAL_CAPITAL_DEPLOYED,
  MILESTONES,
  UNIT_ECONOMICS,
  getCurrentProFormaMonth,
  cumulativeThrough,
  type Month,
} from "@/lib/ops/pro-forma";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtDollar = (n: number) =>
  n < 0
    ? "-$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDollarExact = (n: number) =>
  n < 0
    ? "-$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPercent = (n: number) => (n * 100).toFixed(1) + "%";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLORS = {
  bg: "#f8f5ef",
  navy: "#1B2A4A",
  red: "#c7362c",
  gold: "#c7a062",
  white: "#ffffff",
  lightBorder: "#e8e2d6",
  subtleText: "#7a7060",
  greenAccent: "#2e7d32",
  lightRed: "rgba(199, 54, 44, 0.08)",
  lightGold: "rgba(199, 160, 98, 0.08)",
  lightNavy: "rgba(27, 42, 74, 0.06)",
  liveGreen: "#16a34a",
  lightGreen: "rgba(22, 163, 74, 0.08)",
};

// ---------------------------------------------------------------------------
// Shared Styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: COLORS.white,
  border: `1px solid ${COLORS.lightBorder}`,
  borderRadius: 8,
  padding: "20px 24px",
  position: "relative",
  overflow: "hidden",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: COLORS.navy,
  margin: 0,
  letterSpacing: "-0.01em",
};

const liveBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.1em",
  color: COLORS.liveGreen,
  background: COLORS.lightGreen,
  border: `1px solid ${COLORS.liveGreen}`,
  borderRadius: 3,
  padding: "2px 6px",
  textTransform: "uppercase" as const,
};

const planBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.1em",
  color: COLORS.gold,
  background: COLORS.lightGold,
  border: `1px solid ${COLORS.gold}`,
  borderRadius: 3,
  padding: "2px 6px",
  textTransform: "uppercase" as const,
};

// ---------------------------------------------------------------------------
// Helper Components — Live Data Indicators
// ---------------------------------------------------------------------------

function PulseDot({ color = COLORS.liveGreen }: { color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        animation: "pulse 1.5s infinite",
      }}
    />
  );
}

function LoadingSkeleton({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        background: COLORS.lightNavy,
        animation: "pulse 1.5s infinite",
      }}
    />
  );
}

function VarianceBadge({ pva }: { pva: PlanVsActual }) {
  if (pva.status === "no-data") return null;
  const color = STATUS_COLORS[pva.status];
  const sign = pva.variance >= 0 ? "+" : "";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 700,
        color,
        background: color + "14",
        border: `1px solid ${color}40`,
        borderRadius: 3,
        padding: "1px 6px",
        letterSpacing: "0.02em",
      }}
    >
      {sign}{(pva.variancePct * 100).toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI Card Component
// ---------------------------------------------------------------------------

type LucideIcon = React.ForwardRefExoticComponent<Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>>;

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accentColor,
  liveValue,
  liveLabel,
  pva,
  liveLoading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subtitle?: string;
  accentColor?: string;
  liveValue?: string;
  liveLabel?: string;
  pva?: PlanVsActual;
  liveLoading?: boolean;
}) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accentColor || COLORS.navy,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon size={16} color={COLORS.subtleText} strokeWidth={1.8} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.subtleText,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {label}
            </span>
          </div>
          {/* Plan value */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div
              style={{
                fontSize: liveValue ? 22 : 28,
                fontWeight: 700,
                color: liveValue ? COLORS.subtleText : COLORS.navy,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {value}
            </div>
            {liveValue && (
              <span style={{ fontSize: 10, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase" }}>
                Plan
              </span>
            )}
          </div>
          {/* Live actual value */}
          {liveLoading && (
            <div style={{ marginTop: 6 }}>
              <LoadingSkeleton width={100} height={16} />
            </div>
          )}
          {liveValue && !liveLoading && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: pva ? STATUS_COLORS[pva.status] : COLORS.navy,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {liveValue}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.liveGreen, textTransform: "uppercase" }}>
                  {liveLabel || "Actual"}
                </span>
                {pva && <VarianceBadge pva={pva} />}
              </div>
            </div>
          )}
          {subtitle && (
            <div style={{ fontSize: 12, color: COLORS.subtleText, marginTop: 6 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span style={planBadge}>Plan</span>
          {liveValue && !liveLoading && <span style={liveBadge}>Live</span>}
          {liveLoading && <PulseDot color={COLORS.gold} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel Card Component
// ---------------------------------------------------------------------------

function ChannelCard({
  name,
  icon: Icon,
  accentColor,
  units,
  revenue,
  gp,
  gpPerUnit,
}: {
  name: string;
  icon: LucideIcon;
  accentColor: string;
  units: number;
  revenue: number;
  gp: number;
  gpPerUnit: number;
}) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accentColor,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: accentColor + "12",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={18} color={accentColor} strokeWidth={2} />
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.navy, margin: 0 }}>{name}</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Annual Units
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.navy, marginTop: 2 }}>
            {fmt(units)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Revenue
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.navy, marginTop: 2 }}>
            {fmtDollar(revenue)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Gross Profit
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.navy, marginTop: 2 }}>
            {fmtDollar(gp)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            GP / Unit
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: accentColor, marginTop: 2 }}>
            {fmtDollarExact(gpPerUnit)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip for Charts
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: COLORS.white,
        border: `1px solid ${COLORS.lightBorder}`,
        borderRadius: 6,
        padding: "10px 14px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.navy, marginBottom: 6 }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i} style={{ fontSize: 12, color: entry.color, marginBottom: 2 }}>
          {entry.name}: {fmtDollar(entry.value)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function OpsDashboard() {
  // ------ Live data hooks ------
  const { data: liveData, loading: liveLoading, error: liveError, refresh } = useDashboardData();
  const { data: balances, loading: balLoading } = useBalancesData();

  // ------ MTD Plan vs Actual computation ------
  const currentMonth = getCurrentProFormaMonth();
  const mtdPlanRevenue = currentMonth ? cumulativeThrough(TOTAL_REVENUE, currentMonth) : 0;
  const revenuePva = comparePlanVsActual(mtdPlanRevenue, liveData?.combined.totalRevenue);

  // ------ Build chart data (plan + actual overlay) ------
  const revenueChartData = useMemo(() => {
    // Aggregate live daily data into monthly buckets keyed by MONTH_LABELS
    const actualByMonth: Record<string, number> = {};
    if (liveData?.chartData) {
      for (const d of liveData.chartData) {
        const dateObj = new Date(d.date);
        const monthIdx = dateObj.getMonth(); // 0=Jan
        // Map month index to our MONTH_LABELS: Mar=2, Apr=3 ... Dec=11
        const monthKey = MONTHS[monthIdx - 2]; // Mar is index 0 in MONTHS
        if (monthKey) {
          const lbl = MONTH_LABELS[monthKey];
          actualByMonth[lbl] = (actualByMonth[lbl] || 0) + d.combined;
        }
      }
    }

    let cumulative = 0;
    return MONTHS.map((m) => {
      cumulative += TOTAL_REVENUE[m];
      const lbl = MONTH_LABELS[m];
      return {
        month: lbl,
        revenue: Math.round(TOTAL_REVENUE[m]),
        cumulative: Math.round(cumulative),
        ebitda: Math.round(EBITDA[m]),
        actualRevenue: actualByMonth[lbl] ? Math.round(actualByMonth[lbl]) : undefined,
      };
    });
  }, [liveData]);

  // ------ Channel annual totals ------
  const channelTotals = useMemo(() => {
    const sumChannel = (channel: { units: Record<Month, number>; revenue: Record<Month, number>; grossProfit: Record<Month, number> }) => {
      let u = 0, r = 0, g = 0;
      for (const m of MONTHS) {
        u += channel.units[m];
        r += channel.revenue[m];
        g += channel.grossProfit[m];
      }
      return { units: u, revenue: r, gp: g };
    };
    return {
      amazon: sumChannel(AMAZON),
      wholesale: sumChannel(WHOLESALE),
      distributor: sumChannel(DISTRIBUTOR),
    };
  }, []);

  // ------ Capital deployment categories (grouped) ------
  const deploymentGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const item of CAPITAL_DEPLOYMENT) {
      const key = item.category.replace(/ -- .*$/, "").replace(/ \u2014 .*$/, "").split(" \u2014")[0];
      const baseCategory =
        key.startsWith("Inventory") ? "Inventory" :
        key.startsWith("Display") ? "Display Program" :
        key.startsWith("Email") ? "Email & Domain" :
        key.startsWith("Amazon") ? "Amazon (PPC + Listing)" :
        key.startsWith("Faire") ? "Faire / B2B" :
        key.startsWith("A+") ? "Content & Creative" :
        key.startsWith("Google") ? "Google Ads" :
        key.startsWith("Road") ? "Road Sales" :
        key.startsWith("Rent") ? "Rent & G&A" :
        key.startsWith("Working") ? "Working Capital Reserve" :
        "Other";
      groups[baseCategory] = (groups[baseCategory] || 0) + item.amount;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, []);

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, padding: "32px 24px 64px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* ================================================================
            HEADER
        ================================================================ */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <Target size={24} color={COLORS.red} strokeWidth={2} />
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: COLORS.navy,
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              Command Center
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: 36 }}>
            <span style={{ fontSize: 14, color: COLORS.subtleText }}>
              {monthYear}
            </span>
            <span style={{ color: COLORS.lightBorder }}>|</span>
            <span style={{ fontSize: 13, color: COLORS.subtleText }}>
              Full-Year 2026 Plan Targets + Live Actuals
            </span>
            <span style={planBadge}>Pro Forma v22</span>
            {liveData && !liveLoading && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.liveGreen, fontWeight: 600 }}>
                <PulseDot />
                LIVE
              </span>
            )}
            {liveLoading && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.gold, fontWeight: 600 }}>
                <PulseDot color={COLORS.gold} />
                Loading...
              </span>
            )}
          </div>
          {liveError && (
            <div style={{ marginLeft: 36, marginTop: 4, fontSize: 12, color: COLORS.red, display: "flex", alignItems: "center", gap: 6 }}>
              ⚠ Live data unavailable — showing plan only
            </div>
          )}
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

        {/* ================================================================
            KPI CARDS — 6 cards, 3 columns x 2 rows
        ================================================================ */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginBottom: 32,
          }}
        >
          <KpiCard
            icon={DollarSign}
            label="Total Revenue"
            value={fmtDollar(ANNUAL_SUMMARY.totalRevenue)}
            subtitle="10 months (Mar-Dec)"
            accentColor={COLORS.red}
            liveValue={liveData ? liveFmtDollar(liveData.combined.totalRevenue) : undefined}
            liveLabel="MTD Actual"
            pva={liveData ? revenuePva : undefined}
            liveLoading={liveLoading}
          />
          <KpiCard
            icon={Package}
            label="Total Units Sold"
            value={fmt(ANNUAL_SUMMARY.totalUnits)}
            subtitle="All channels combined"
            accentColor={COLORS.navy}
            liveValue={liveData ? fmt(liveData.combined.totalOrders) : undefined}
            liveLabel="MTD Orders"
            liveLoading={liveLoading}
          />
          <KpiCard
            icon={TrendingUp}
            label="EBITDA (Full Year)"
            value={fmtDollar(ANNUAL_SUMMARY.ebitda)}
            subtitle="Investment year -- EBITDA+ by June"
            accentColor={COLORS.gold}
          />
          <KpiCard
            icon={Landmark}
            label="Loan Balance (Dec 31)"
            value={fmtDollar(ANNUAL_SUMMARY.loanBalanceDec31)}
            subtitle={`of ${fmtDollar(LOAN.totalObligation)} total obligation`}
            accentColor={COLORS.navy}
          />
          <KpiCard
            icon={BarChart3}
            label="Blended Gross Margin"
            value={fmtPercent(ANNUAL_SUMMARY.blendedGrossMargin)}
            subtitle={`${fmtDollar(ANNUAL_SUMMARY.totalGrossProfit)} gross profit`}
            accentColor={COLORS.red}
            liveValue={liveData ? fmtDollarExact(liveData.combined.avgOrderValue) : undefined}
            liveLabel="Avg Order Value"
            liveLoading={liveLoading}
          />
          <KpiCard
            icon={Wallet}
            label="Cash Position (Dec 31)"
            value={fmtDollar(ANNUAL_SUMMARY.closingCashDec31)}
            subtitle="Closing cash after all obligations"
            accentColor={COLORS.greenAccent}
            liveValue={balances ? liveFmtDollar(balances.totalCash) : undefined}
            liveLabel="Current Cash"
            pva={balances ? comparePlanVsActual(ANNUAL_SUMMARY.closingCashDec31, balances.totalCash) : undefined}
            liveLoading={balLoading}
          />
        </div>

        {/* ================================================================
            LIVE PERFORMANCE — Real-time actuals from Shopify + Amazon
        ================================================================ */}
        <div
          style={{
            ...cardStyle,
            marginBottom: 32,
            padding: "20px 24px",
            borderLeft: `4px solid ${liveData ? COLORS.liveGreen : COLORS.gold}`,
            background: liveData ? `linear-gradient(135deg, ${COLORS.white}, ${COLORS.lightGreen})` : COLORS.white,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Activity size={18} color={liveData ? COLORS.liveGreen : COLORS.subtleText} strokeWidth={2} />
              <h2 style={{ ...sectionTitleStyle, fontSize: 16 }}>
                Live Performance
              </h2>
              {liveData && <PulseDot />}
              <span style={liveBadge}>MTD Actuals</span>
            </div>
            <button
              onClick={refresh}
              disabled={liveLoading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${COLORS.lightBorder}`,
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.navy,
                background: COLORS.white,
                cursor: liveLoading ? "not-allowed" : "pointer",
                opacity: liveLoading ? 0.6 : 1,
              }}
            >
              <RefreshCw size={12} strokeWidth={2.5} style={liveLoading ? { animation: "spin 1s linear infinite" } : undefined} />
              Refresh
            </button>
          </div>
          {liveLoading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {[1, 2, 3, 4].map((i) => (
                <LoadingSkeleton key={i} height={60} />
              ))}
            </div>
          )}
          {liveData && !liveLoading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div style={{ background: COLORS.lightGreen, borderRadius: 8, padding: 16, border: `1px solid ${COLORS.liveGreen}20` }}>
                <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Combined Revenue
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.navy, marginTop: 4 }}>
                  {liveFmtDollar(liveData.combined.totalRevenue)}
                </div>
                {revenuePva.status !== "no-data" && (
                  <div style={{ marginTop: 4 }}>
                    <VarianceBadge pva={revenuePva} />
                    <span style={{ fontSize: 10, color: COLORS.subtleText, marginLeft: 6 }}>
                      vs {liveFmtDollar(mtdPlanRevenue)} plan
                    </span>
                  </div>
                )}
              </div>
              <div style={{ background: COLORS.lightNavy, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Combined Orders
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.navy, marginTop: 4 }}>
                  {fmt(liveData.combined.totalOrders)}
                </div>
              </div>
              <div style={{ background: COLORS.lightNavy, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Avg Order Value
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.navy, marginTop: 4 }}>
                  {fmtDollarExact(liveData.combined.avgOrderValue)}
                </div>
              </div>
              <div style={{ background: balances ? "rgba(46, 125, 50, 0.06)" : COLORS.lightNavy, borderRadius: 8, padding: 16, border: balances ? `1px solid ${COLORS.greenAccent}20` : "none" }}>
                <div style={{ fontSize: 11, color: COLORS.subtleText, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Cash Position
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.greenAccent, marginTop: 4 }}>
                  {balLoading ? "..." : balances ? liveFmtDollar(balances.totalCash) : "N/A"}
                </div>
              </div>
            </div>
          )}
          {liveData && (
            <div style={{ marginTop: 12, fontSize: 11, color: COLORS.subtleText, textAlign: "right" }}>
              Last updated: {new Date(liveData.generatedAt).toLocaleString()}
            </div>
          )}
          {!liveData && !liveLoading && liveError && (
            <div style={{ textAlign: "center", padding: 20, color: COLORS.subtleText, fontSize: 13 }}>
              <AlertTriangle size={16} color={COLORS.gold} style={{ verticalAlign: "middle", marginRight: 8 }} />
              Live data unavailable -- check API connection
            </div>
          )}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

        {/* ================================================================
            REVENUE TRAJECTORY CHART
        ================================================================ */}
        <div style={{ ...cardStyle, marginBottom: 32, padding: "24px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={sectionTitleStyle}>Revenue Trajectory -- 2026</h2>
              <p style={{ fontSize: 13, color: COLORS.subtleText, margin: "4px 0 0" }}>
                Plan targets vs actual monthly revenue across all channels
              </p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={planBadge}>Pro Forma</span>
              {liveData && <span style={liveBadge}>+ Actual</span>}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={revenueChartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={COLORS.red} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="cumulativeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.navy} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={COLORS.navy} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.lightBorder} vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: COLORS.subtleText }}
                axisLine={{ stroke: COLORS.lightBorder }}
                tickLine={false}
              />
              <YAxis
                yAxisId="monthly"
                orientation="left"
                tick={{ fontSize: 11, fill: COLORS.subtleText }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
              />
              <YAxis
                yAxisId="cumulative"
                orientation="right"
                tick={{ fontSize: 11, fill: COLORS.subtleText }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="line"
                wrapperStyle={{ fontSize: 12, color: COLORS.subtleText, paddingBottom: 8 }}
              />
              <Area
                yAxisId="monthly"
                type="monotone"
                dataKey="revenue"
                name="Plan (Monthly)"
                stroke={COLORS.red}
                strokeWidth={2.5}
                fill="url(#revenueGradient)"
              />
              <Bar
                yAxisId="monthly"
                dataKey="actualRevenue"
                name="Actual (Monthly)"
                fill={COLORS.liveGreen}
                fillOpacity={0.7}
                radius={[3, 3, 0, 0]}
                barSize={24}
              />
              <Line
                yAxisId="cumulative"
                type="monotone"
                dataKey="cumulative"
                name="Cumulative Plan"
                stroke={COLORS.navy}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ fill: COLORS.navy, r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ================================================================
            CHANNEL MIX — 3 columns
        ================================================================ */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ ...sectionTitleStyle, marginBottom: 16 }}>Channel Mix -- Annual Targets</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <ChannelCard
              name="Amazon FBA"
              icon={ShoppingCart}
              accentColor={COLORS.gold}
              units={channelTotals.amazon.units}
              revenue={channelTotals.amazon.revenue}
              gp={channelTotals.amazon.gp}
              gpPerUnit={UNIT_ECONOMICS.amazon.gpPerUnit}
            />
            <ChannelCard
              name="Wholesale (Direct)"
              icon={Store}
              accentColor={COLORS.navy}
              units={channelTotals.wholesale.units}
              revenue={channelTotals.wholesale.revenue}
              gp={channelTotals.wholesale.gp}
              gpPerUnit={UNIT_ECONOMICS.wholesale.gpPerUnit}
            />
            <ChannelCard
              name="Distributor Network"
              icon={Truck}
              accentColor={COLORS.red}
              units={channelTotals.distributor.units}
              revenue={channelTotals.distributor.revenue}
              gp={channelTotals.distributor.gp}
              gpPerUnit={UNIT_ECONOMICS.distributor.gpPerUnit}
            />
          </div>
        </div>

        {/* ================================================================
            CAPITAL DEPLOYMENT SUMMARY
        ================================================================ */}
        <div style={{ ...cardStyle, marginBottom: 32, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={sectionTitleStyle}>Capital Deployment</h2>
              <p style={{ fontSize: 13, color: COLORS.subtleText, margin: "4px 0 0" }}>
                {fmtDollar(TOTAL_CAPITAL_DEPLOYED)} total deployed from {fmtDollar(LOAN.principal)} raise
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.navy }}>
                {fmtDollar(TOTAL_CAPITAL_DEPLOYED)}
              </div>
              <div style={{ fontSize: 11, color: COLORS.subtleText }}>TOTAL DEPLOYED</div>
            </div>
          </div>

          {/* Progress bar */}
          <div
            style={{
              height: 8,
              background: COLORS.lightBorder,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, (TOTAL_CAPITAL_DEPLOYED / LOAN.principal) * 100)}%`,
                background: `linear-gradient(90deg, ${COLORS.red}, ${COLORS.gold})`,
                borderRadius: 4,
                transition: "width 0.6s ease",
              }}
            />
          </div>

          {/* Deployment Table */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 80px",
                padding: "8px 12px",
                borderBottom: `2px solid ${COLORS.lightBorder}`,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.subtleText, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Category
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.subtleText, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>
                Amount
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.subtleText, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>
                % of Total
              </span>
            </div>
            {/* Rows */}
            {deploymentGroups.map(([category, amount], i) => (
              <div
                key={category}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px 80px",
                  padding: "10px 12px",
                  borderBottom: `1px solid ${COLORS.lightBorder}`,
                  background: i % 2 === 0 ? "transparent" : COLORS.lightNavy,
                }}
              >
                <span style={{ fontSize: 13, color: COLORS.navy, fontWeight: 500 }}>{category}</span>
                <span style={{ fontSize: 13, color: COLORS.navy, fontWeight: 600, textAlign: "right" }}>
                  {fmtDollar(amount)}
                </span>
                <span style={{ fontSize: 13, color: COLORS.subtleText, textAlign: "right" }}>
                  {((amount / TOTAL_CAPITAL_DEPLOYED) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ================================================================
            MILESTONES TIMELINE
        ================================================================ */}
        <div style={{ ...cardStyle, padding: 24 }}>
          <h2 style={{ ...sectionTitleStyle, marginBottom: 20 }}>Key Milestones -- 2026</h2>

          <div style={{ position: "relative", padding: "0 0 0 20px" }}>
            {/* Vertical line */}
            <div
              style={{
                position: "absolute",
                left: 8,
                top: 4,
                bottom: 4,
                width: 2,
                background: COLORS.lightBorder,
              }}
            />

            {MILESTONES.map((ms, i) => {
              const isHighlight =
                ms.id === "ebitda-positive" ||
                ms.id === "cash-floor" ||
                ms.id === "100k-units";

              const monthLabel =
                typeof ms.targetMonth === "string" && ms.targetMonth in MONTH_FULL_LABELS
                  ? MONTH_FULL_LABELS[ms.targetMonth as Month]
                  : ms.targetMonth;

              return (
                <div
                  key={ms.id}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                    paddingBottom: i < MILESTONES.length - 1 ? 20 : 0,
                  }}
                >
                  {/* Dot on timeline */}
                  <div
                    style={{
                      position: "absolute",
                      left: -16,
                      top: 3,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: isHighlight ? COLORS.red : COLORS.white,
                      border: `2px solid ${isHighlight ? COLORS.red : COLORS.gold}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1,
                    }}
                  >
                    {isHighlight && (
                      <CheckCircle size={8} color={COLORS.white} strokeWidth={3} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, paddingLeft: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: COLORS.gold,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          minWidth: 80,
                        }}
                      >
                        {monthLabel}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: isHighlight ? 700 : 500,
                          color: COLORS.navy,
                        }}
                      >
                        {ms.label}
                      </span>
                      {isHighlight && (
                        <Flag size={12} color={COLORS.red} strokeWidth={2.5} />
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.subtleText, marginTop: 2, paddingLeft: 90 }}>
                      {ms.unit === "dollars"
                        ? `Target: ${fmtDollar(ms.threshold)}`
                        : `Target: ${fmt(ms.threshold)} ${ms.unit}`}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Final milestone: Full repayment */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -16,
                  top: 3,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: COLORS.greenAccent,
                  border: `2px solid ${COLORS.greenAccent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1,
                }}
              >
                <CheckCircle size={8} color={COLORS.white} strokeWidth={3} />
              </div>
              <div style={{ flex: 1, paddingLeft: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: COLORS.greenAccent,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      minWidth: 80,
                    }}
                  >
                    Feb 2028
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: COLORS.navy,
                    }}
                  >
                    Full Loan Repayment
                  </span>
                  <Flag size={12} color={COLORS.greenAccent} strokeWidth={2.5} />
                </div>
                <div style={{ fontSize: 12, color: COLORS.subtleText, marginTop: 2, paddingLeft: 90 }}>
                  {fmtDollar(LOAN.totalObligation)} fully repaid ({fmtDollar(LOAN.principal)} + {fmtPercent(LOAN.flatReturnRate)} return)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================
            FOOTER
        ================================================================ */}
        <div style={{ textAlign: "center", marginTop: 40, paddingBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.subtleText, letterSpacing: "0.05em" }}>
            USA GUMMIES -- PRO FORMA V22 -- CONFIDENTIAL
          </div>
          {liveData && (
            <div style={{ fontSize: 10, color: COLORS.subtleText, marginTop: 4, opacity: 0.7 }}>
              Live data as of {new Date(liveData.generatedAt).toLocaleString()}
              {balances && ` | Cash data as of ${new Date(balances.lastUpdated).toLocaleString()}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
