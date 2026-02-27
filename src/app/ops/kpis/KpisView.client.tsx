"use client";

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
  type Month,
} from "@/lib/ops/pro-forma";

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
// Sub-components
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

  // Milestones timeline data
  const timelineItems = [
    { month: "Mar", label: "Launch", highlight: true, description: "First shipments, Amazon live" },
    { month: "May", label: "Distributor #1", highlight: false, description: "Brent Inderbitzin live" },
    { month: "Jun", label: "EBITDA Positive", highlight: true, description: "Month 4 profitability" },
    { month: "Aug", label: "Loan Repayment", highlight: false, description: "15% revenue begins" },
    { month: "Aug", label: "Distributor #2", highlight: false, description: "Second territory" },
    { month: "Nov", label: "Distributor #3", highlight: false, description: "Third territory" },
    { month: "Dec", label: "Year 1 Complete", highlight: true, description: "108K+ units shipped" },
    { month: "Feb '28", label: "Loan Repaid", highlight: true, description: "$324K fully repaid" },
  ];

  const sectionHeading = (text: string) => ({
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
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: NAVY,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Scoreboard
        </h1>
        <p style={{ fontSize: 14, color: MUTED, margin: "6px 0 0 0" }}>
          Key Performance Indicators &mdash; Plan Targets &middot; Year 1 (March&ndash;December 2026)
        </p>
      </div>

      {/* ── 1. TRAFFIC LIGHT KPIs ──────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 8 }}>
        <KpiCard
          icon={<DollarSign size={18} color={NAVY} />}
          title="Revenue Target"
          value={fmt$(ANNUAL_SUMMARY.totalRevenue)}
          subtitle="Plan Target"
        />
        <KpiCard
          icon={<Package size={18} color={NAVY} />}
          title="Units Target"
          value={fmtComma(ANNUAL_SUMMARY.totalUnits)}
          subtitle="Plan Target"
        />
        <KpiCard
          icon={<TrendingUp size={18} color={NAVY} />}
          title="EBITDA Positive"
          value="June (Mo. 4)"
          subtitle="Plan Target"
        />
        <KpiCard
          icon={<BarChart3 size={18} color={NAVY} />}
          title="Gross Margin"
          value={fmtPct(blendedGM)}
          subtitle="Blended Target"
        />
        <KpiCard
          icon={<CreditCard size={18} color={NAVY} />}
          title="Loan Repayment"
          value="Feb 2028"
          subtitle="Projected Payoff"
        />
        <KpiCard
          icon={<Landmark size={18} color={NAVY} />}
          title="Cash at Year End"
          value={fmt$(ANNUAL_SUMMARY.closingCashDec31)}
          subtitle="Dec 31, 2026"
        />
      </div>

      {/* ── 2. MONTHLY TARGET GRID ─────────────────────────── */}
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
            {grid.map((r, i) => {
              const isEbitdaPositive = r.ebitda > 0;
              const isFirstPositive = r.month === "jun";
              return (
                <tr
                  key={r.month}
                  style={{
                    background: isFirstPositive ? `${GOLD}18` : i % 2 === 0 ? WHITE : "#faf8f4",
                    fontWeight: isFirstPositive ? 700 : 400,
                    borderLeft: isFirstPositive ? `3px solid ${GOLD}` : "3px solid transparent",
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
              <td style={{ padding: "12px 14px" }}>TOTAL</td>
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

      {/* ── 3. MILESTONE TRACKER ───────────────────────────── */}
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
            {timelineItems.map((item, idx) => (
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
                    width: item.highlight ? 28 : 18,
                    height: item.highlight ? 28 : 18,
                    borderRadius: "50%",
                    background: item.highlight ? RED : NAVY,
                    border: `3px solid ${WHITE}`,
                    boxShadow: item.highlight
                      ? `0 0 0 3px ${RED}40, 0 2px 8px rgba(0,0,0,0.15)`
                      : `0 0 0 2px ${NAVY}30`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 10,
                  }}
                >
                  {item.highlight && <CheckCircle size={12} color={WHITE} />}
                </div>
                {/* Month badge */}
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: WHITE,
                    background: item.highlight ? RED : MUTED,
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
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 4. ANNUAL PROJECTION SUMMARY ───────────────────── */}
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
          </div>
        </div>
      </div>

      {/* ── 5. CHANNEL KPI COMPARISON ──────────────────────── */}
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
      </div>
    </div>
  );
}
