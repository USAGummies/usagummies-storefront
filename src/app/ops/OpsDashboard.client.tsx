"use client";

import { useMemo } from "react";
import type { LucideProps } from "lucide-react";
import {
  Area,
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
// KPI Card Component
// ---------------------------------------------------------------------------

type LucideIcon = React.ForwardRefExoticComponent<Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>>;

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accentColor,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subtitle?: string;
  accentColor?: string;
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
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.navy,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {value}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: COLORS.subtleText, marginTop: 6 }}>{subtitle}</div>
          )}
        </div>
        <span style={planBadge}>Plan</span>
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
  // ------ Build chart data ------
  const revenueChartData = useMemo(() => {
    let cumulative = 0;
    return MONTHS.map((m) => {
      cumulative += TOTAL_REVENUE[m];
      return {
        month: MONTH_LABELS[m],
        revenue: Math.round(TOTAL_REVENUE[m]),
        cumulative: Math.round(cumulative),
        ebitda: Math.round(EBITDA[m]),
      };
    });
  }, []);

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
              Full-Year 2026 Plan Targets
            </span>
            <span style={planBadge}>Pro Forma v22</span>
          </div>
        </div>

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
          />
          <KpiCard
            icon={Package}
            label="Total Units Sold"
            value={fmt(ANNUAL_SUMMARY.totalUnits)}
            subtitle="All channels combined"
            accentColor={COLORS.navy}
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
          />
          <KpiCard
            icon={Wallet}
            label="Cash Position (Dec 31)"
            value={fmtDollar(ANNUAL_SUMMARY.closingCashDec31)}
            subtitle="Closing cash after all obligations"
            accentColor={COLORS.greenAccent}
          />
        </div>

        {/* ================================================================
            REVENUE TRAJECTORY CHART
        ================================================================ */}
        <div style={{ ...cardStyle, marginBottom: 32, padding: "24px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={sectionTitleStyle}>Revenue Trajectory -- 2026 Plan</h2>
              <p style={{ fontSize: 13, color: COLORS.subtleText, margin: "4px 0 0" }}>
                Monthly revenue and cumulative trajectory across all channels
              </p>
            </div>
            <span style={planBadge}>Pro Forma</span>
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
                name="Monthly Revenue"
                stroke={COLORS.red}
                strokeWidth={2.5}
                fill="url(#revenueGradient)"
              />
              <Line
                yAxisId="cumulative"
                type="monotone"
                dataKey="cumulative"
                name="Cumulative Revenue"
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
        </div>
      </div>
    </div>
  );
}
