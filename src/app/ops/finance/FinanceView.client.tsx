"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, Area, AreaChart, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Landmark, PiggyBank,
  BarChart3, Wallet, CreditCard, Building2, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, Banknote,
} from "lucide-react";
import {
  MONTHS, MONTH_LABELS,
  TOTAL_REVENUE, TOTAL_GROSS_PROFIT, TOTAL_OPEX, EBITDA,
  LOAN_REPAYMENT,
  CAPITAL_DEPLOYMENT, TOTAL_CAPITAL_DEPLOYED,
  FULL_REPAYMENT_SCHEDULE,
  LOAN, UNIT_ECONOMICS, ANNUAL_SUMMARY,
  AMAZON, WHOLESALE, DISTRIBUTOR,
  MARKETING, RENT_GA, ONE_TIME_SETUP,
  type Month,
} from "@/lib/ops/pro-forma";
import {
  usePnLData,
  useBalancesData,
  useDashboardData,
  comparePlanVsActual,
  fmtDollar,
  fmtDollarExact,
  fmtPercent,
  fmtVariance,
  STATUS_COLORS,
  type PlanVsActual,
} from "@/lib/ops/use-war-room-data";

// ─── Design tokens ──────────────────────────────────────────────────────────
const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const CREAM = "#f8f5ef";
const WHITE = "#ffffff";
const LIGHT_BORDER = "#e2ddd4";
const SUBTLE_BG = "#f0ede5";
const GREEN_POSITIVE = "#1a7a3a";
const GREEN_BG = "rgba(26,122,58,0.06)";
const RED_NEGATIVE = "#c7362c";

// Palette for capital categories
const CAPITAL_COLORS = [
  "#1B2A4A", "#c7362c", "#c7a062", "#3b6b9e", "#8b5e3c",
  "#5a7d4f", "#7b4f8a", "#2d8e9e", "#d4843e", "#4a4a6a",
];

// ─── Formatting helpers ─────────────────────────────────────────────────────
function fmt(n: number, decimals = 0): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 ? `($${formatted})` : `$${formatted}`;
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// ─── Derived data ───────────────────────────────────────────────────────────

// Extended 12-month labels
const TWELVE_MONTHS = [...MONTHS, "jan27" as const, "feb27" as const] as const;
type ExtMonth = (typeof TWELVE_MONTHS)[number];

const EXTENDED_LABELS: Record<ExtMonth, string> = {
  mar: "Mar 26", apr: "Apr 26", may: "May 26", jun: "Jun 26",
  jul: "Jul 26", aug: "Aug 26", sep: "Sep 26", oct: "Oct 26",
  nov: "Nov 26", dec: "Dec 26", jan27: "Jan 27", feb27: "Feb 27",
};

// Extend monthly data with Jan/Feb 2027 projections (10% MoM growth from Dec)
function extendData(data: Record<Month, number>): Record<ExtMonth, number> {
  const jan = data.dec * 1.10;
  const feb = jan * 1.10;
  return { ...data, jan27: jan, feb27: feb } as Record<ExtMonth, number>;
}

const EXT_REVENUE = extendData(TOTAL_REVENUE);
const EXT_GP = extendData(TOTAL_GROSS_PROFIT);
const EXT_OPEX = extendData(TOTAL_OPEX);
const EXT_EBITDA = extendData(EBITDA);
const EXT_LOAN_REPAYMENT = extendData(LOAN_REPAYMENT);

// Net cash flow = EBITDA - Loan Repayment
const NET_CASH_FLOW: Record<ExtMonth, number> = {} as Record<ExtMonth, number>;
for (const m of TWELVE_MONTHS) {
  NET_CASH_FLOW[m] = EXT_EBITDA[m] - EXT_LOAN_REPAYMENT[m];
}

// COGS = Revenue - Gross Profit
const EXT_COGS: Record<ExtMonth, number> = {} as Record<ExtMonth, number>;
for (const m of TWELVE_MONTHS) {
  EXT_COGS[m] = EXT_REVENUE[m] - EXT_GP[m];
}

// Annual totals
function sumExtended(data: Record<ExtMonth, number>): number {
  return TWELVE_MONTHS.reduce((s, m) => s + data[m], 0);
}

// Capital deployment by high-level category (aggregate)
type CapGroup = { name: string; value: number };
function groupCapital(): CapGroup[] {
  const groups: Record<string, number> = {};
  for (const item of CAPITAL_DEPLOYMENT) {
    // Simplify to high-level buckets
    let bucket: string;
    if (item.category.includes("Inventory")) bucket = "Inventory";
    else if (item.category.includes("Display")) bucket = "Display Program";
    else if (item.category.includes("Amazon PPC")) bucket = "Amazon PPC";
    else if (item.category.includes("Road Sales")) bucket = "Road Sales";
    else if (item.category.includes("Rent")) bucket = "Rent";
    else if (item.category.includes("Google")) bucket = "Google Ads";
    else if (item.category.includes("Working Capital")) bucket = "Working Capital Reserve";
    else bucket = item.category;
    groups[bucket] = (groups[bucket] || 0) + item.amount;
  }
  return Object.entries(groups)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

const CAPITAL_GROUPS = groupCapital();

// Build monthly OpEx breakdown from pro-forma constants
function buildOpExTimeline(): Array<Record<string, string | number>> {
  return MONTHS.map((m) => {
    const total = TOTAL_OPEX[m];
    const marketing = MARKETING[m];
    const rent = RENT_GA[m];
    const oneTime = ONE_TIME_SETUP[m];
    const other = Math.max(0, total - marketing - rent - oneTime);
    return {
      month: MONTH_LABELS[m],
      Marketing: marketing,
      "Rent / G&A": rent,
      "One-Time Setup": oneTime,
      Other: other,
    };
  });
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: CREAM,
  color: NAVY,
  minHeight: "100vh",
  padding: "32px 28px 60px",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  maxWidth: 1200,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  marginBottom: 36,
  borderBottom: `2px solid ${NAVY}`,
  paddingBottom: 16,
};

const h1Style: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: NAVY,
  margin: 0,
  letterSpacing: "-0.02em",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: GOLD,
  fontWeight: 600,
  marginTop: 4,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: NAVY,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginBottom: 16,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const cardStyle: React.CSSProperties = {
  background: WHITE,
  border: `1px solid ${LIGHT_BORDER}`,
  borderRadius: 8,
  padding: "24px",
  marginBottom: 28,
  boxShadow: "0 1px 3px rgba(27,42,74,0.04)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left" as const,
  padding: "8px 10px",
  borderBottom: `2px solid ${NAVY}`,
  fontWeight: 700,
  color: NAVY,
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  whiteSpace: "nowrap" as const,
};

const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: "right" as const };

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: `1px solid ${LIGHT_BORDER}`,
  fontSize: 12,
  whiteSpace: "nowrap" as const,
};

const tdRightStyle: React.CSSProperties = { ...tdStyle, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" };

const totalRowStyle: React.CSSProperties = {
  fontWeight: 800,
  background: SUBTLE_BG,
};

const metricCardStyle: React.CSSProperties = {
  background: WHITE,
  border: `1px solid ${LIGHT_BORDER}`,
  borderRadius: 8,
  padding: "18px 20px",
  flex: "1 1 200px",
  boxShadow: "0 1px 3px rgba(27,42,74,0.04)",
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: GOLD,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 4,
};

const metricValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: NAVY,
};

// ─── Tooltip formatter for Recharts ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const currencyTooltip: any = (value: number) => fmt(value);

// ─── Variance helper for inline display ──────────────────────────────────────
function VarianceBadge({ pva }: { pva: PlanVsActual }) {
  if (pva.status === "no-data") {
    return <span style={{ fontSize: 10, color: STATUS_COLORS["no-data"], fontStyle: "italic" }}>--</span>;
  }
  const color = STATUS_COLORS[pva.status];
  const sign = pva.variance >= 0 ? "+" : "";
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color }}>
      {sign}{fmtDollar(pva.variance)} ({sign}{(pva.variancePct * 100).toFixed(1)}%)
    </span>
  );
}

// ─── Pulse dot for LIVE indicator ────────────────────────────────────────────
function LiveDot() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 12 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#16a34a",
          display: "inline-block",
          boxShadow: "0 0 6px rgba(22,163,74,0.6)",
          animation: "pulse 2s infinite",
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: "0.04em" }}>LIVE</span>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </span>
  );
}

// ─── Loading shimmer ─────────────────────────────────────────────────────────
function LoadingShimmer({ width = "100%", height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      width,
      height,
      borderRadius: 4,
      background: `linear-gradient(90deg, ${SUBTLE_BG} 25%, ${LIGHT_BORDER} 50%, ${SUBTLE_BG} 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function FinanceView() {
  const [expandedCapital, setExpandedCapital] = useState(true);
  const [expandedPnL, setExpandedPnL] = useState(true);
  const [expandedLoan, setExpandedLoan] = useState(true);
  const [expandedUnit, setExpandedUnit] = useState(true);
  const [expandedOpEx, setExpandedOpEx] = useState(true);
  const [expandedCash, setExpandedCash] = useState(true);
  const [expandedActualPnL, setExpandedActualPnL] = useState(true);

  // ── Live data hooks
  const { data: pnl, loading: pnlLoading, error: pnlError } = usePnLData();
  const { data: balances, loading: balLoading } = useBalancesData();
  const { data: dashboard, loading: dashLoading } = useDashboardData();

  const liveDataAvailable = !!(pnl || balances || dashboard);
  const anyLoading = pnlLoading || balLoading || dashLoading;
  const hasError = !!(pnlError);

  // ── Section toggle helper
  function SectionHeader({ title, icon, expanded, toggle }: {
    title: string; icon: React.ReactNode; expanded: boolean; toggle: () => void;
  }) {
    return (
      <div
        style={{ ...sectionTitleStyle, cursor: "pointer", userSelect: "none" }}
        onClick={toggle}
      >
        {icon}
        {title}
        <span style={{ marginLeft: "auto" }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. HEADER KPI STRIP
  // ══════════════════════════════════════════════════════════════════════════
  const annualRevenue = ANNUAL_SUMMARY.totalRevenue;
  const annualEBITDA = ANNUAL_SUMMARY.ebitda;
  const closingCash = ANNUAL_SUMMARY.closingCashDec31;
  const loanBal = ANNUAL_SUMMARY.loanBalanceDec31;

  // Live revenue comparison — use March plan as first month baseline
  const liveRevenue = pnl?.revenue?.total ?? null;
  const livePlanRevComparison = comparePlanVsActual(
    TOTAL_REVENUE.mar,
    liveRevenue
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 2. CAPITAL DEPLOYMENT
  // ══════════════════════════════════════════════════════════════════════════
  const capitalBarData = CAPITAL_GROUPS.map((g, i) => ({
    ...g,
    fill: CAPITAL_COLORS[i % CAPITAL_COLORS.length],
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // 3. P&L TABLE (Plan)
  // ══════════════════════════════════════════════════════════════════════════
  const pnlRows = [
    { label: "Revenue", data: EXT_REVENUE, bold: false, green: false },
    { label: "COGS", data: EXT_COGS, bold: false, green: false },
    { label: "Gross Profit", data: EXT_GP, bold: true, green: false },
    { label: "OpEx", data: EXT_OPEX, bold: false, green: false },
    { label: "EBITDA", data: EXT_EBITDA, bold: true, green: true },
    { label: "Loan Repayment", data: EXT_LOAN_REPAYMENT, bold: false, green: false },
    { label: "Net Cash Flow", data: NET_CASH_FLOW, bold: true, green: false },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // ACTUAL P&L TABLE ROWS (from live API data)
  // ══════════════════════════════════════════════════════════════════════════
  type ActualPnLRow = {
    label: string;
    plan: number;
    actual: number | null;
    bold: boolean;
    isMargin?: boolean;
    indent?: boolean;
  };

  // Build the actual vs plan P&L rows from the current period's live data
  // The plan amounts here are cumulative through the current month for YTD comparison
  // For simplicity, we'll use the March plan values as baseline (first month)
  const currentMonthPlan = {
    revenueAmazon: AMAZON.revenue.mar,
    revenueShopify: 0, // Shopify DTC not in original pro forma (it's wholesale)
    revenueWholesale: WHOLESALE.revenue.mar,
    revenueTotal: TOTAL_REVENUE.mar,
    cogsTotal: TOTAL_REVENUE.mar - TOTAL_GROSS_PROFIT.mar,
    grossProfit: TOTAL_GROSS_PROFIT.mar,
    opexTotal: TOTAL_OPEX.mar,
    netIncome: EBITDA.mar, // EBITDA as proxy for net income in month 1
  };

  const actualPnLRows: ActualPnLRow[] = pnl ? [
    { label: "Amazon Revenue", plan: currentMonthPlan.revenueAmazon, actual: pnl.revenue.amazon, bold: false, indent: true },
    { label: "Shopify Revenue", plan: currentMonthPlan.revenueShopify, actual: pnl.revenue.shopify, bold: false, indent: true },
    { label: "Wholesale Revenue", plan: currentMonthPlan.revenueWholesale, actual: pnl.revenue.wholesale, bold: false, indent: true },
    { label: "Total Revenue", plan: currentMonthPlan.revenueTotal, actual: pnl.revenue.total, bold: true },
    { label: "Product Cost", plan: 0, actual: pnl.cogs.productCost, bold: false, indent: true },
    { label: "Shipping", plan: 0, actual: pnl.cogs.shipping, bold: false, indent: true },
    { label: "Amazon Fees", plan: 0, actual: pnl.cogs.amazonFees, bold: false, indent: true },
    { label: "Shopify Fees", plan: 0, actual: pnl.cogs.shopifyFees, bold: false, indent: true },
    { label: "Total COGS", plan: currentMonthPlan.cogsTotal, actual: pnl.cogs.total, bold: true },
    { label: "Gross Profit", plan: currentMonthPlan.grossProfit, actual: pnl.grossProfit, bold: true },
    { label: "Gross Margin", plan: ANNUAL_SUMMARY.blendedGrossMargin, actual: pnl.grossMargin, bold: false, isMargin: true },
    { label: "Software", plan: 0, actual: pnl.opex.software, bold: false, indent: true },
    { label: "Marketing", plan: MARKETING.mar, actual: pnl.opex.marketing, bold: false, indent: true },
    { label: "Payroll", plan: 0, actual: pnl.opex.payroll, bold: false, indent: true },
    { label: "Other OpEx", plan: 0, actual: pnl.opex.other, bold: false, indent: true },
    { label: "Total OpEx", plan: currentMonthPlan.opexTotal, actual: pnl.opex.total, bold: true },
    { label: "Net Income", plan: currentMonthPlan.netIncome, actual: pnl.netIncome, bold: true },
    { label: "Net Margin", plan: 0, actual: pnl.netMargin, bold: false, isMargin: true },
  ] : [];

  // ══════════════════════════════════════════════════════════════════════════
  // 4. LOAN REPAYMENT CHART
  // ══════════════════════════════════════════════════════════════════════════
  const loanChartData = FULL_REPAYMENT_SCHEDULE.map((entry) => ({
    month: entry.month.replace(" 20", " '"),
    balance: entry.balanceRemaining,
    repayment: entry.repayment,
    cumRepaid: entry.cumulativeRepaid,
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // 5. UNIT ECONOMICS CARDS
  // ══════════════════════════════════════════════════════════════════════════
  const unitEconChannels = [
    {
      channel: "Amazon FBA",
      icon: <Building2 size={16} color={RED} />,
      cogs: UNIT_ECONOMICS.cogsPerBag,
      fbaFees: UNIT_ECONOMICS.amazon.fbaFees,
      totalCost: UNIT_ECONOMICS.cogsPerBag + UNIT_ECONOMICS.amazon.fbaFees,
      retailPrice: UNIT_ECONOMICS.amazon.retailPrice,
      gp: UNIT_ECONOMICS.amazon.gpPerUnit,
      margin: UNIT_ECONOMICS.amazon.gpPerUnit / UNIT_ECONOMICS.amazon.retailPrice,
      accentColor: RED,
    },
    {
      channel: "Wholesale (B2B)",
      icon: <Landmark size={16} color={NAVY} />,
      cogs: UNIT_ECONOMICS.cogsPerBag,
      fbaFees: 0,
      totalCost: UNIT_ECONOMICS.cogsPerBag,
      retailPrice: UNIT_ECONOMICS.wholesale.price,
      gp: UNIT_ECONOMICS.wholesale.gpPerUnit,
      margin: UNIT_ECONOMICS.wholesale.gpPerUnit / UNIT_ECONOMICS.wholesale.price,
      accentColor: NAVY,
    },
    {
      channel: "Distributor",
      icon: <CreditCard size={16} color={GOLD} />,
      cogs: UNIT_ECONOMICS.cogsPerBag,
      fbaFees: UNIT_ECONOMICS.distributor.displayCostPerUnit,
      totalCost: UNIT_ECONOMICS.cogsPerBag + UNIT_ECONOMICS.distributor.displayCostPerUnit,
      retailPrice: UNIT_ECONOMICS.distributor.sellPrice,
      gp: UNIT_ECONOMICS.distributor.gpPerUnit,
      margin: UNIT_ECONOMICS.distributor.gpPerUnit / UNIT_ECONOMICS.distributor.sellPrice,
      accentColor: GOLD,
    },
  ];

  const gpComparisonData = unitEconChannels.map((c) => ({
    channel: c.channel.split(" ")[0],
    gp: c.gp,
    margin: c.margin,
    fill: c.accentColor,
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // 6. OPEX BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════════
  const opexTimelineData = buildOpExTimeline();

  // Aggregate OpEx for pie chart (full year)
  const totalMarketingYear = MONTHS.reduce((s, m) => s + MARKETING[m], 0);
  const totalRentYear = MONTHS.reduce((s, m) => s + RENT_GA[m], 0);
  const totalOneTimeYear = MONTHS.reduce((s, m) => s + ONE_TIME_SETUP[m], 0);
  const totalOtherYear = ANNUAL_SUMMARY.totalOpex - totalMarketingYear - totalRentYear - totalOneTimeYear;

  const opexPieData = [
    { name: "Marketing / Ads", value: totalMarketingYear, color: RED },
    { name: "Rent / G&A", value: totalRentYear, color: NAVY },
    { name: "One-Time Setup", value: totalOneTimeYear, color: GOLD },
    { name: "Other (SW, Ins, Logistics)", value: Math.max(0, totalOtherYear), color: "#5a7d4f" },
  ].filter((d) => d.value > 0);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={containerStyle}>
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h1 style={h1Style}>Financial Operations</h1>
          {liveDataAvailable && !anyLoading && <LiveDot />}
          {anyLoading && (
            <span style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <RefreshCw size={14} color={GOLD} style={{ animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>Loading live data...</span>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </span>
          )}
        </div>
        <div style={subtitleStyle}>
          Pro Forma v22 — Capital &amp; Cash Flow Tracking
          {liveDataAvailable && pnl?.period?.label && (
            <span style={{ marginLeft: 8, color: GREEN_POSITIVE, fontWeight: 700 }}>
              | Live Period: {pnl.period.label}
            </span>
          )}
        </div>
      </div>

      {/* ── ERROR BANNER ────────────────────────────────────────────────── */}
      {hasError && !anyLoading && (
        <div style={{
          background: "rgba(199,54,44,0.06)",
          border: `1px solid ${RED}`,
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: RED,
          fontWeight: 500,
        }}>
          <AlertTriangle size={16} />
          Live data unavailable — showing plan only. Check API connections.
        </div>
      )}

      {/* ── KPI STRIP ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 32 }}>
        {/* Year 1 Revenue (Plan) + Live Actual */}
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Year 1 Revenue (Plan)</div>
          <div style={metricValueStyle}>{fmt(annualRevenue)}</div>
          {pnl && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: GOLD, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                MTD Actual
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: GREEN_POSITIVE }}>
                {fmtDollar(pnl.revenue.total)}
              </div>
              <VarianceBadge pva={livePlanRevComparison} />
            </div>
          )}
          {pnlLoading && <div style={{ marginTop: 6 }}><LoadingShimmer height={20} /></div>}
        </div>

        {/* Year 1 EBITDA */}
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Year 1 EBITDA</div>
          <div style={{ ...metricValueStyle, color: annualEBITDA < 0 ? RED_NEGATIVE : GREEN_POSITIVE }}>
            {fmt(annualEBITDA)}
          </div>
          {pnl && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: GOLD, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                MTD Net Income
              </div>
              <div style={{
                fontSize: 18, fontWeight: 800,
                color: pnl.netIncome >= 0 ? GREEN_POSITIVE : RED_NEGATIVE,
              }}>
                {fmtDollar(pnl.netIncome)}
              </div>
            </div>
          )}
          {pnlLoading && <div style={{ marginTop: 6 }}><LoadingShimmer height={20} /></div>}
        </div>

        {/* Closing Cash — show live total if available */}
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>
            {balances ? "Total Cash (Live)" : "Closing Cash (Dec 31 Plan)"}
          </div>
          <div style={{ ...metricValueStyle, color: GREEN_POSITIVE }}>
            {balances ? fmtDollar(balances.totalCash) : fmt(closingCash)}
          </div>
          {balances && (
            <div style={{ fontSize: 10, color: "#7a7060", marginTop: 2 }}>
              Plan Dec 31: {fmt(closingCash)}
            </div>
          )}
          {balLoading && <LoadingShimmer height={24} />}
        </div>

        {/* Loan Balance */}
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Loan Balance (Dec 31)</div>
          <div style={metricValueStyle}>{fmt(loanBal)}</div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          NEW SECTION: CASH POSITION (Live)
          ══════════════════════════════════════════════════════════════════ */}
      <div style={{ ...cardStyle, borderLeft: `4px solid ${GREEN_POSITIVE}` }}>
        <SectionHeader
          title="Cash Position"
          icon={<Banknote size={18} color={GREEN_POSITIVE} />}
          expanded={expandedCash}
          toggle={() => setExpandedCash(!expandedCash)}
        />
        {expandedCash && (
          <>
            {balLoading && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ ...metricCardStyle, flex: "1 1 200px" }}>
                    <LoadingShimmer height={12} width="60%" />
                    <div style={{ marginTop: 8 }}><LoadingShimmer height={28} width="80%" /></div>
                  </div>
                ))}
              </div>
            )}

            {!balLoading && !balances && (
              <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic", padding: "12px 0" }}>
                Cash position data unavailable. Connect Found.com, Shopify Payments, and Amazon Seller Central to see live balances.
              </div>
            )}

            {balances && (
              <>
                {/* Total Cash - prominent */}
                <div style={{
                  background: `linear-gradient(135deg, ${NAVY} 0%, #2d4a7a 100%)`,
                  borderRadius: 8,
                  padding: "20px 24px",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Total Cash Position
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: WHITE, marginTop: 4 }}>
                      {fmtDollar(balances.totalCash)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>
                      Last updated: {new Date(balances.lastUpdated).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>
                      Plan Dec 31: {fmt(closingCash)} | Runway: Healthy
                    </div>
                  </div>
                </div>

                {/* Individual accounts */}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {/* Found.com */}
                  <div style={{ ...metricCardStyle, flex: "1 1 200px", borderTop: `3px solid ${NAVY}` }}>
                    <div style={metricLabelStyle}>Found.com (Operating)</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>
                      {balances.found ? fmtDollar(balances.found.balance) : "--"}
                    </div>
                    {balances.found && (
                      <div style={{ fontSize: 10, color: "#7a7060", marginTop: 2 }}>
                        Available: {fmtDollar(balances.found.available)}
                      </div>
                    )}
                    {!balances.found && (
                      <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Not connected</div>
                    )}
                  </div>

                  {/* Shopify Payments */}
                  <div style={{ ...metricCardStyle, flex: "1 1 200px", borderTop: `3px solid #96bf48` }}>
                    <div style={metricLabelStyle}>Shopify Payments</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>
                      {balances.shopify ? fmtDollar(balances.shopify.balance) : "--"}
                    </div>
                    {balances.shopify?.pendingPayouts && balances.shopify.pendingPayouts.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: GOLD, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>
                          Pending Payouts
                        </div>
                        {balances.shopify.pendingPayouts.slice(0, 3).map((p, i) => (
                          <div key={i} style={{ fontSize: 10, color: "#7a7060", display: "flex", justifyContent: "space-between" }}>
                            <span>{p.expectedDate ? new Date(p.expectedDate).toLocaleDateString() : "Pending"}</span>
                            <span style={{ fontWeight: 600 }}>{fmtDollarExact(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!balances.shopify && (
                      <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Not connected</div>
                    )}
                  </div>

                  {/* Amazon Pending */}
                  <div style={{ ...metricCardStyle, flex: "1 1 200px", borderTop: `3px solid ${RED}` }}>
                    <div style={metricLabelStyle}>Amazon Pending</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>
                      {balances.amazon ? fmtDollar(balances.amazon.pendingBalance) : "--"}
                    </div>
                    {balances.amazon?.lastSettlement && (
                      <div style={{ fontSize: 10, color: "#7a7060", marginTop: 2 }}>
                        Last settlement: {fmtDollar(balances.amazon.lastSettlement.amount)} on{" "}
                        {new Date(balances.amazon.lastSettlement.date).toLocaleDateString()}
                      </div>
                    )}
                    {!balances.amazon && (
                      <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Not connected</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          NEW SECTION: ACTUAL P&L (Live vs Plan)
          ══════════════════════════════════════════════════════════════════ */}
      <div style={{ ...cardStyle, borderLeft: `4px solid ${GREEN_POSITIVE}` }}>
        <SectionHeader
          title={`P&L — Plan vs Actual${pnl?.period?.label ? ` (${pnl.period.label})` : ""}`}
          icon={<TrendingUp size={18} color={GREEN_POSITIVE} />}
          expanded={expandedActualPnL}
          toggle={() => setExpandedActualPnL(!expandedActualPnL)}
        />
        {expandedActualPnL && (
          <>
            {pnlLoading && (
              <div style={{ padding: "16px 0" }}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} style={{ marginBottom: 8 }}><LoadingShimmer height={18} /></div>
                ))}
              </div>
            )}

            {!pnlLoading && !pnl && (
              <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic", padding: "12px 0" }}>
                P&amp;L live data unavailable. Showing plan-only P&amp;L table below.
              </div>
            )}

            {pnl && (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, minWidth: 160 }}>Line Item</th>
                      <th style={thRightStyle}>Plan</th>
                      <th style={{ ...thRightStyle, color: GREEN_POSITIVE }}>Actual</th>
                      <th style={thRightStyle}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actualPnLRows.map((row) => {
                      const pva = row.isMargin
                        ? null
                        : comparePlanVsActual(row.plan, row.actual);

                      return (
                        <tr
                          key={row.label}
                          style={row.bold ? { background: SUBTLE_BG } : undefined}
                        >
                          <td style={{
                            ...tdStyle,
                            fontWeight: row.bold ? 800 : 500,
                            paddingLeft: row.indent ? 28 : 10,
                            fontSize: row.indent ? 11 : 12,
                          }}>
                            {row.label}
                          </td>
                          <td style={{
                            ...tdRightStyle,
                            color: "#7a7060",
                            fontSize: 11,
                            fontWeight: row.bold ? 600 : 400,
                          }}>
                            {row.isMargin
                              ? (row.plan ? fmtPct(row.plan) : "--")
                              : (row.plan ? fmt(row.plan) : "--")}
                          </td>
                          <td style={{
                            ...tdRightStyle,
                            fontWeight: row.bold ? 800 : 600,
                            color: row.actual !== null
                              ? (row.isMargin ? NAVY : (row.actual < 0 ? RED_NEGATIVE : NAVY))
                              : "#94a3b8",
                          }}>
                            {row.actual !== null
                              ? (row.isMargin ? fmtPct(row.actual) : fmt(Math.round(row.actual)))
                              : "--"}
                          </td>
                          <td style={{
                            ...tdRightStyle,
                            fontSize: 11,
                          }}>
                            {row.isMargin ? (
                              row.actual !== null && row.plan ? (
                                <span style={{
                                  color: row.actual >= row.plan ? GREEN_POSITIVE : RED_NEGATIVE,
                                  fontWeight: 600,
                                }}>
                                  {(row.actual - row.plan) >= 0 ? "+" : ""}{((row.actual - row.plan) * 100).toFixed(1)}pp
                                </span>
                              ) : <span style={{ color: "#94a3b8" }}>--</span>
                            ) : (
                              pva ? <VarianceBadge pva={pva} /> : <span style={{ color: "#94a3b8" }}>--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Period info */}
                <div style={{ fontSize: 10, color: "#9a9080", marginTop: 8, fontStyle: "italic" }}>
                  Period: {pnl.period.start} to {pnl.period.end} | Generated: {new Date(pnl.generatedAt).toLocaleString()}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1: CAPITAL DEPLOYMENT TRACKER
          ══════════════════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <SectionHeader
          title="Capital Deployment Tracker"
          icon={<PiggyBank size={18} color={NAVY} />}
          expanded={expandedCapital}
          toggle={() => setExpandedCapital(!expandedCapital)}
        />
        {expandedCapital && (
          <>
            {/* Stacked horizontal bar */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: GOLD, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Allocation by Category — Total: {fmt(TOTAL_CAPITAL_DEPLOYED)}
              </div>
              <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", border: `1px solid ${LIGHT_BORDER}` }}>
                {CAPITAL_GROUPS.map((g, i) => {
                  const pct = (g.value / TOTAL_CAPITAL_DEPLOYED) * 100;
                  return (
                    <div
                      key={g.name}
                      title={`${g.name}: ${fmt(g.value)} (${pct.toFixed(1)}%)`}
                      style={{
                        width: `${pct}%`,
                        background: CAPITAL_COLORS[i % CAPITAL_COLORS.length],
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        color: WHITE,
                        fontWeight: 700,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pct > 6 ? `${pct.toFixed(0)}%` : ""}
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10 }}>
                {CAPITAL_GROUPS.map((g, i) => (
                  <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: CAPITAL_COLORS[i % CAPITAL_COLORS.length] }} />
                    <span style={{ color: NAVY, fontWeight: 500 }}>{g.name}</span>
                    <span style={{ color: GOLD, fontWeight: 700 }}>{fmt(g.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Full detail table */}
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Category</th>
                    <th style={thRightStyle}>Amount</th>
                    <th style={thRightStyle}>% of Total</th>
                    <th style={thStyle}>Deploy Month</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {CAPITAL_DEPLOYMENT.map((item, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{item.category}</td>
                      <td style={tdRightStyle}>{fmt(item.amount)}</td>
                      <td style={tdRightStyle}>{((item.amount / TOTAL_CAPITAL_DEPLOYED) * 100).toFixed(1)}%</td>
                      <td style={tdStyle}>{item.deployMonth}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: "#7a7060" }}>{item.notes}</td>
                    </tr>
                  ))}
                  <tr style={totalRowStyle}>
                    <td style={{ ...tdStyle, fontWeight: 800 }}>TOTAL</td>
                    <td style={{ ...tdRightStyle, fontWeight: 800 }}>{fmt(TOTAL_CAPITAL_DEPLOYED)}</td>
                    <td style={{ ...tdRightStyle, fontWeight: 800 }}>100.0%</td>
                    <td style={tdStyle} />
                    <td style={tdStyle} />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2: MONTHLY P&L TABLE (Full Year Plan)
          ══════════════════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <SectionHeader
          title="Monthly P&L Statement (Plan)"
          icon={<BarChart3 size={18} color={NAVY} />}
          expanded={expandedPnL}
          toggle={() => setExpandedPnL(!expandedPnL)}
        />
        {expandedPnL && (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, position: "sticky", left: 0, background: WHITE, zIndex: 2, minWidth: 120 }}>Line Item</th>
                  {TWELVE_MONTHS.map((m) => (
                    <th key={m} style={thRightStyle}>{EXTENDED_LABELS[m]}</th>
                  ))}
                  <th style={{ ...thRightStyle, borderLeft: `2px solid ${NAVY}`, minWidth: 90 }}>Annual</th>
                </tr>
              </thead>
              <tbody>
                {pnlRows.map((row) => {
                  const annual = sumExtended(row.data);
                  return (
                    <tr
                      key={row.label}
                      style={row.bold ? { fontWeight: 700 } : undefined}
                    >
                      <td style={{
                        ...tdStyle,
                        fontWeight: row.bold ? 800 : 500,
                        position: "sticky",
                        left: 0,
                        background: WHITE,
                        zIndex: 1,
                        borderRight: `1px solid ${LIGHT_BORDER}`,
                      }}>
                        {row.label}
                      </td>
                      {TWELVE_MONTHS.map((m) => {
                        const val = row.data[m];
                        const isEBITDAPositive = row.green && val > 0;
                        const isNeg = val < 0;
                        return (
                          <td
                            key={m}
                            style={{
                              ...tdRightStyle,
                              fontWeight: row.bold ? 700 : 400,
                              color: isNeg ? RED_NEGATIVE : isEBITDAPositive ? GREEN_POSITIVE : NAVY,
                              background: isEBITDAPositive ? GREEN_BG : "transparent",
                            }}
                          >
                            {fmt(val)}
                          </td>
                        );
                      })}
                      <td style={{
                        ...tdRightStyle,
                        fontWeight: 800,
                        borderLeft: `2px solid ${NAVY}`,
                        color: annual < 0 ? RED_NEGATIVE : NAVY,
                      }}>
                        {fmt(annual)}
                      </td>
                    </tr>
                  );
                })}
                {/* Gross margin row */}
                <tr>
                  <td style={{
                    ...tdStyle,
                    fontStyle: "italic",
                    fontSize: 11,
                    color: "#7a7060",
                    position: "sticky",
                    left: 0,
                    background: WHITE,
                    zIndex: 1,
                    borderRight: `1px solid ${LIGHT_BORDER}`,
                  }}>
                    Gross Margin %
                  </td>
                  {TWELVE_MONTHS.map((m) => {
                    const rev = EXT_REVENUE[m];
                    const gp = EXT_GP[m];
                    const margin = rev > 0 ? gp / rev : 0;
                    return (
                      <td key={m} style={{ ...tdRightStyle, fontSize: 11, fontStyle: "italic", color: "#7a7060" }}>
                        {fmtPct(margin)}
                      </td>
                    );
                  })}
                  <td style={{
                    ...tdRightStyle,
                    borderLeft: `2px solid ${NAVY}`,
                    fontSize: 11,
                    fontStyle: "italic",
                    color: "#7a7060",
                  }}>
                    {fmtPct(sumExtended(EXT_GP) / sumExtended(EXT_REVENUE))}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "#9a9080", marginTop: 8, fontStyle: "italic" }}>
              Jan/Feb 2027 figures are projected at 10% MoM growth from December 2026 actuals.
              EBITDA-positive months highlighted in green.
            </div>
          </div>
        )}
      </div>

      {/* ── EBITDA CHART ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>
          <TrendingUp size={18} color={NAVY} />
          EBITDA Trend (Mar 2026 — Feb 2027)
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={TWELVE_MONTHS.map((m) => ({
            month: EXTENDED_LABELS[m],
            ebitda: EXT_EBITDA[m],
            fill: EXT_EBITDA[m] >= 0 ? GREEN_POSITIVE : RED,
          }))}>
            <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_BORDER} />
            <XAxis dataKey="month" fontSize={10} tick={{ fill: NAVY }} />
            <YAxis fontSize={10} tick={{ fill: NAVY }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip formatter={currencyTooltip} contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }} />
            <Bar dataKey="ebitda" name="EBITDA" radius={[3, 3, 0, 0]}>
              {TWELVE_MONTHS.map((m) => (
                <Cell key={m} fill={EXT_EBITDA[m] >= 0 ? GREEN_POSITIVE : RED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3: LOAN REPAYMENT TIMELINE
          ══════════════════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <SectionHeader
          title="Loan Repayment Timeline"
          icon={<Landmark size={18} color={NAVY} />}
          expanded={expandedLoan}
          toggle={() => setExpandedLoan(!expandedLoan)}
        />
        {expandedLoan && (
          <>
            {/* Key stats */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <div style={{ ...metricCardStyle, borderLeft: `3px solid ${RED}` }}>
                <div style={metricLabelStyle}>Total Obligation</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{fmt(LOAN.totalObligation)}</div>
                <div style={{ fontSize: 10, color: "#7a7060" }}>${fmtNum(LOAN.principal)} principal + {(LOAN.flatReturnRate * 100).toFixed(0)}% flat</div>
              </div>
              <div style={{ ...metricCardStyle, borderLeft: `3px solid ${NAVY}` }}>
                <div style={metricLabelStyle}>Monthly Rate</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{(LOAN.monthlyRepaymentRate * 100).toFixed(0)}% of Revenue</div>
                <div style={{ fontSize: 10, color: "#7a7060" }}>Begins {LOAN.repaymentStartMonth.toUpperCase()} 2026 (6-mo deferral)</div>
              </div>
              <div style={{ ...metricCardStyle, borderLeft: `3px solid ${GREEN_POSITIVE}` }}>
                <div style={metricLabelStyle}>Projected Payoff</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: GREEN_POSITIVE }}>{LOAN.projectedPayoffDate}</div>
                <div style={{ fontSize: 10, color: "#7a7060" }}>19 months of repayment</div>
              </div>
            </div>

            {/* Area chart */}
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={loanChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_BORDER} />
                <XAxis dataKey="month" fontSize={10} tick={{ fill: NAVY }} interval={2} />
                <YAxis fontSize={10} tick={{ fill: NAVY }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  formatter={((value: number, name: string) => [fmt(value), name === "balance" ? "Balance Remaining" : "Monthly Payment"]) as any}
                  contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke={RED}
                  fill="rgba(199,54,44,0.1)"
                  strokeWidth={2}
                  name="Balance Remaining"
                />
                <Line
                  type="monotone"
                  dataKey="repayment"
                  stroke={NAVY}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Monthly Payment"
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Repayment schedule table */}
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 12, fontWeight: 600, color: NAVY, cursor: "pointer", marginBottom: 8 }}>
                Full Repayment Schedule (19 months)
              </summary>
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Month</th>
                      <th style={thRightStyle}>Revenue</th>
                      <th style={thRightStyle}>Payment (15%)</th>
                      <th style={thRightStyle}>Cum. Repaid</th>
                      <th style={thRightStyle}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FULL_REPAYMENT_SCHEDULE.map((entry, i) => (
                      <tr key={i} style={entry.balanceRemaining === 0 ? { background: GREEN_BG, fontWeight: 700 } : undefined}>
                        <td style={tdStyle}>{entry.month}</td>
                        <td style={tdRightStyle}>{fmt(entry.revenue)}</td>
                        <td style={tdRightStyle}>{fmt(entry.repayment, 2)}</td>
                        <td style={tdRightStyle}>{fmt(entry.cumulativeRepaid, 2)}</td>
                        <td style={{
                          ...tdRightStyle,
                          fontWeight: entry.balanceRemaining === 0 ? 800 : 400,
                          color: entry.balanceRemaining === 0 ? GREEN_POSITIVE : NAVY,
                        }}>
                          {fmt(entry.balanceRemaining, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4: UNIT ECONOMICS BREAKDOWN
          ══════════════════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <SectionHeader
          title="Unit Economics Breakdown"
          icon={<Wallet size={18} color={NAVY} />}
          expanded={expandedUnit}
          toggle={() => setExpandedUnit(!expandedUnit)}
        />
        {expandedUnit && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
              {unitEconChannels.map((ch) => (
                <div
                  key={ch.channel}
                  style={{
                    flex: "1 1 280px",
                    background: WHITE,
                    border: `1px solid ${LIGHT_BORDER}`,
                    borderTop: `3px solid ${ch.accentColor}`,
                    borderRadius: 8,
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                    {ch.icon}
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{ch.channel}</span>
                  </div>

                  {/* Margin waterfall */}
                  <div style={{ fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${LIGHT_BORDER}` }}>
                      <span>Sell Price</span>
                      <span style={{ fontWeight: 700 }}>{fmt(ch.retailPrice, 2)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${LIGHT_BORDER}`, color: RED_NEGATIVE }}>
                      <span>COGS / bag</span>
                      <span>({fmt(ch.cogs, 2).replace("$", "").replace("(", "").replace(")", "")})</span>
                    </div>
                    {ch.fbaFees > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${LIGHT_BORDER}`, color: RED_NEGATIVE }}>
                        <span>{ch.channel === "Amazon FBA" ? "FBA + Referral Fees" : "Display Cost / unit"}</span>
                        <span>({fmt(ch.fbaFees, 2).replace("$", "").replace("(", "").replace(")", "")})</span>
                      </div>
                    )}
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      fontWeight: 800,
                      fontSize: 14,
                      color: ch.gp > 0 ? GREEN_POSITIVE : RED_NEGATIVE,
                    }}>
                      <span>GP / unit</span>
                      <span>{fmt(ch.gp, 2)}</span>
                    </div>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "4px 0",
                      fontSize: 11,
                      color: GOLD,
                      fontWeight: 600,
                    }}>
                      <span>Margin</span>
                      <span>{fmtPct(ch.margin)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* GP comparison bar chart */}
            <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Gross Profit per Unit Comparison
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={gpComparisonData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_BORDER} />
                <XAxis type="number" fontSize={10} tick={{ fill: NAVY }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                <YAxis type="category" dataKey="channel" width={80} fontSize={11} tick={{ fill: NAVY }} />
                <Tooltip
                  formatter={((value: number) => [`$${value.toFixed(2)}`, "GP / Unit"]) as any}
                  contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }}
                />
                <Bar dataKey="gp" name="GP / Unit" radius={[0, 4, 4, 0]} barSize={24}>
                  {gpComparisonData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5: OPEX BREAKDOWN
          ══════════════════════════════════════════════════════════════════ */}
      <div style={cardStyle}>
        <SectionHeader
          title="Operating Expense Breakdown"
          icon={<DollarSign size={18} color={NAVY} />}
          expanded={expandedOpEx}
          toggle={() => setExpandedOpEx(!expandedOpEx)}
        />
        {expandedOpEx && (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
              {/* Pie chart */}
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Annual OpEx Composition — {fmt(ANNUAL_SUMMARY.totalOpex)}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={opexPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      dataKey="value"
                      nameKey="name"
                      label={(({ name, percent }: { name: string; percent: number }) =>
                        `${name.split("/")[0].trim()} ${(percent * 100).toFixed(0)}%`
                      ) as any}
                      labelLine={false}
                      fontSize={9}
                    >
                      {opexPieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={((value: number) => [fmt(value), "Annual"]) as any}
                      contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* OpEx summary cards */}
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Category Detail
                </div>
                {opexPieData.map((item) => (
                  <div
                    key={item.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      borderBottom: `1px solid ${LIGHT_BORDER}`,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 2, background: item.color }} />
                      <span style={{ fontWeight: 500 }}>{item.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span style={{ fontWeight: 700 }}>{fmt(item.value)}</span>
                      <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>
                        {((item.value / ANNUAL_SUMMARY.totalOpex) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  fontWeight: 800,
                  fontSize: 13,
                  background: SUBTLE_BG,
                  borderRadius: "0 0 4px 4px",
                }}>
                  <span>Total OpEx</span>
                  <span>{fmt(ANNUAL_SUMMARY.totalOpex)}</span>
                </div>
              </div>
            </div>

            {/* Monthly OpEx stacked bar */}
            <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monthly OpEx by Category
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={opexTimelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_BORDER} />
                <XAxis dataKey="month" fontSize={10} tick={{ fill: NAVY }} />
                <YAxis fontSize={10} tick={{ fill: NAVY }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  formatter={currencyTooltip}
                  contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="One-Time Setup" stackId="opex" fill={GOLD} />
                <Bar dataKey="Marketing" stackId="opex" fill={RED} />
                <Bar dataKey="Rent / G&A" stackId="opex" fill={NAVY} />
                <Bar dataKey="Other" stackId="opex" fill="#5a7d4f" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ── Channel Revenue Mix ────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>
          <TrendingDown size={18} color={NAVY} />
          Revenue by Channel (Monthly)
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={MONTHS.map((m) => ({
            month: MONTH_LABELS[m],
            Amazon: AMAZON.revenue[m],
            Wholesale: WHOLESALE.revenue[m],
            Distributor: DISTRIBUTOR.revenue[m],
          }))}>
            <CartesianGrid strokeDasharray="3 3" stroke={LIGHT_BORDER} />
            <XAxis dataKey="month" fontSize={10} tick={{ fill: NAVY }} />
            <YAxis fontSize={10} tick={{ fill: NAVY }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              formatter={currencyTooltip}
              contentStyle={{ background: WHITE, border: `1px solid ${LIGHT_BORDER}`, fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Amazon" stackId="rev" fill={RED} />
            <Bar dataKey="Wholesale" stackId="rev" fill={NAVY} />
            <Bar dataKey="Distributor" stackId="rev" fill={GOLD} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{
        textAlign: "center",
        fontSize: 10,
        color: "#9a9080",
        marginTop: 40,
        paddingTop: 16,
        borderTop: `1px solid ${LIGHT_BORDER}`,
      }}>
        USA Gummies Inc. — Pro Forma v22 Financial Operations Report — Confidential
        {liveDataAvailable && (
          <span style={{ display: "block", color: GREEN_POSITIVE, fontWeight: 600, marginTop: 4 }}>
            Live data connected | Last refresh: {new Date().toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
