"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Wallet, TrendingUp, Flame, AlertTriangle, Landmark, Briefcase } from "lucide-react";

import {
  usePnLData,
  useBalancesData,
  useTransactions,
  useForecastData,
  useDashboardData,
  comparePlanVsActual,
  fmtDollar,
  STATUS_COLORS,
} from "@/lib/ops/use-war-room-data";
import {
  TOTAL_REVENUE,
  EBITDA,
  GROSS_MARGIN,
  UNIT_ECONOMICS,
  LOAN,
  LOAN_REPAYMENT,
  LOAN_BALANCE,
  AMORTIZATION_SCHEDULE,
  FULL_REPAYMENT_SCHEDULE,
  CAPITAL_DEPLOYMENT,
  CAPITAL_BY_MONTH,
  TOTAL_CAPITAL_DEPLOYED,
  CAPITAL_TO_DATE,
  FOUNDER_CAPITAL_2025,
  FOUNDER_CAPITAL_2026_YTD,
  FOUNDER_CAPITAL_TOTAL,
  ANNUAL_SUMMARY,
  getCurrentProFormaMonth,
  getMonthsThrough,
  cumulativeThrough,
} from "@/lib/ops/pro-forma";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function HeaderCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span
          style={{
            fontSize: 11,
            color: TEXT_DIM,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{hint}</div> : null}
    </div>
  );
}

export function FinanceView() {
  const { data: pnl, loading: pnlLoading, error: pnlError } = usePnLData();
  const { data: balances, loading: balLoading, error: balError } = useBalancesData();
  const { data: tx, loading: txLoading, error: txError } = useTransactions(30);
  const { data: forecast, loading: forecastLoading, error: forecastError } = useForecastData();
  const { data: dashboard } = useDashboardData();

  const month = getCurrentProFormaMonth();
  const monthsThrough = month ? getMonthsThrough(month) : [];

  const planRevenue = month ? cumulativeThrough(TOTAL_REVENUE, month) : 0;
  const planEbitda = month ? cumulativeThrough(EBITDA, month) : 0;
  const planMargin = month ? avg(monthsThrough.map((m) => GROSS_MARGIN[m])) : 0;
  const planCogs = planRevenue * (1 - planMargin);
  const planGrossProfit = planRevenue - planCogs;
  const planOpex = planGrossProfit - planEbitda;

  const burnRate = useMemo(() => {
    const proj = forecast?.projections?.["30d"] || [];
    if (proj.length === 0) return 0;
    const totalOut = proj.reduce((sum, d) => sum + d.outflows, 0);
    const totalIn = proj.reduce((sum, d) => sum + d.inflows, 0);
    return (totalOut - totalIn) / proj.length;
  }, [forecast]);

  const pvaRevenue = comparePlanVsActual(planRevenue, pnl?.revenue.total || 0);
  const pvaGross = comparePlanVsActual(planGrossProfit, pnl?.grossProfit || 0);
  const pvaOpex = comparePlanVsActual(planOpex, pnl?.opex.total || 0);
  const pvaNet = comparePlanVsActual(planEbitda, pnl?.netIncome || 0);

  const forecastChart = (forecast?.projections?.["90d"] || []).map((d) => ({
    date: d.date.slice(5),
    balance: d.closingBalance,
  }));

  const averageSellingPrice =
    dashboard && dashboard.combined.totalOrders > 0
      ? dashboard.combined.totalRevenue / dashboard.combined.totalOrders
      : 0;

  const hasError = pnlError || balError || txError || forecastError;
  const freshnessItems = [
    { label: "P&L", timestamp: pnl?.generatedAt },
    { label: "Balances", timestamp: balances?.lastUpdated },
    { label: "Transactions", timestamp: tx?.generatedAt },
    { label: "Forecast", timestamp: forecast?.generatedAt },
  ];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
          P&L / Finance
        </h1>
        <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
          Live income statement, cash flow, runway, and transaction visibility.
        </div>
        <div style={{ marginTop: 8 }}>
          <StalenessBadge items={freshnessItems} />
        </div>
      </div>

      {hasError ? (
        <div
          style={{
            border: `1px solid ${RED}33`,
            background: `${RED}14`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
          }}
        >
          <AlertTriangle size={16} />
          {hasError}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <HeaderCard
          label="Cash Position"
          value={fmtDollar(balances?.totalCash || 0)}
          hint="Found + Shopify + Amazon"
          icon={<Wallet size={16} />}
        />
        <HeaderCard
          label="Daily Burn Rate"
          value={fmtDollar(burnRate)}
          hint="30d projected average"
          icon={<Flame size={16} />}
        />
        <HeaderCard
          label="Runway"
          value={`${forecast?.runway || 0} days`}
          hint="Days until cash floor"
          icon={<TrendingUp size={16} />}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.7fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 12 }}>Contribution P&L (Actual | Plan | Variance)</div>

          {pnlLoading && !pnl ? (
            <SkeletonTable rows={6} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Line Item</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Actual</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Plan</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Budget</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Revenue",
                      actual: pnl?.revenue.total || 0,
                      plan: planRevenue,
                      pva: pvaRevenue,
                    },
                    {
                      label: "COGS",
                      actual: pnl?.cogs.total || 0,
                      plan: planCogs,
                      pva: comparePlanVsActual(planCogs, pnl?.cogs.total || 0),
                    },
                    {
                      label: "Gross Profit",
                      actual: pnl?.grossProfit || 0,
                      plan: planGrossProfit,
                      pva: pvaGross,
                    },
                    {
                      label: "OpEx",
                      actual: pnl?.opex.total || 0,
                      plan: planOpex,
                      pva: pvaOpex,
                    },
                    {
                      label: "Net Income",
                      actual: pnl?.netIncome || 0,
                      plan: planEbitda,
                      pva: pvaNet,
                    },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", color: NAVY, fontWeight: 700 }}>{row.label}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: NAVY }}>{fmtDollar(row.actual)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: TEXT_DIM }}>{fmtDollar(row.plan)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: TEXT_DIM }}>—</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right" }}>
                        <span
                          style={{
                            color: STATUS_COLORS[row.pva.status],
                            background: `${STATUS_COLORS[row.pva.status]}14`,
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {row.pva.plan === 0 && row.pva.actual === 0
                            ? "—"
                            : row.pva.plan === 0
                              ? "N/A"
                              : `${(row.pva.variancePct * 100).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 12, color: TEXT_DIM }}>
            Budget column is intentionally dormant (`null`) until funding allocations are populated.
          </div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Unit Economics</div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>COGS / bag</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(UNIT_ECONOMICS.cogsPerBag)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Avg selling price</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(averageSellingPrice)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Gross margin</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{(pnl?.grossMargin || 0).toFixed(1)}%</span>
            </div>
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
              <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 6 }}>Channel GP / unit</div>
              <div style={{ display: "grid", gap: 5, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Amazon</span>
                  <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(UNIT_ECONOMICS.amazon.gpPerUnit)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Wholesale</span>
                  <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(UNIT_ECONOMICS.wholesale.gpPerUnit)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Distributor</span>
                  <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(UNIT_ECONOMICS.distributor.gpPerUnit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Loan Amortization + Capital Deployment ────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        {/* Loan Amortization */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Landmark size={16} color={NAVY} />
            <div style={{ fontWeight: 700, color: NAVY }}>Revenue Participation Note</div>
          </div>

          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Principal</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(LOAN.principal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Total Obligation (8% flat)</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(LOAN.totalObligation)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Total Interest</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(LOAN.totalInterest)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Repayment Rate</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>15% of gross revenue</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Deferral Period</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>6 months (starts Aug 2026)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Projected Payoff</span>
              <span style={{ color: "#16a34a", fontWeight: 700 }}>{LOAN.projectedPayoffDate}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>
              <span>{fmtDollar(ANNUAL_SUMMARY.totalLoanRepayment2026)} repaid in 2026</span>
              <span>{((ANNUAL_SUMMARY.totalLoanRepayment2026 / LOAN.totalObligation) * 100).toFixed(1)}%</span>
            </div>
            <div style={{ width: "100%", height: 8, borderRadius: 99, background: BORDER }}>
              <div style={{
                width: `${(ANNUAL_SUMMARY.totalLoanRepayment2026 / LOAN.totalObligation) * 100}%`,
                height: "100%",
                borderRadius: 99,
                background: NAVY,
                transition: "width 0.6s ease",
              }} />
            </div>
          </div>

          {/* 2026 amortization table */}
          <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            2026 Amortization Schedule
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Month</th>
                  <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Revenue</th>
                  <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Payment</th>
                  <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Principal</th>
                  <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Interest</th>
                  <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {AMORTIZATION_SCHEDULE.filter((a) => a.month.includes("2026")).map((a) => (
                  <tr key={a.month}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, color: NAVY, fontWeight: 600 }}>{a.month.replace(" 2026", "")}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: TEXT_DIM }}>{fmtDollar(a.grossRevenue)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: NAVY, fontWeight: 700 }}>{fmtDollar(a.totalPayment)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: NAVY }}>{fmtDollar(a.principalPortion)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: TEXT_DIM }}>{fmtDollar(a.interestPortion)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: NAVY, fontWeight: 600 }}>{fmtDollar(a.principalBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Capital Deployment + Founder Capital */}
        <div style={{ display: "grid", gap: 12 }}>
          {/* Capital Deployment */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Briefcase size={16} color={NAVY} />
              <div style={{ fontWeight: 700, color: NAVY }}>Capital Deployment Plan</div>
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 10 }}>
              {fmtDollar(TOTAL_CAPITAL_DEPLOYED)} total · {fmtDollar(LOAN.principal)} loan proceeds
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              {Object.entries(CAPITAL_BY_MONTH).map(([month, amount]) => {
                const pct = (amount / TOTAL_CAPITAL_DEPLOYED) * 100;
                return (
                  <div key={month}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                      <span style={{ color: NAVY, fontWeight: 600 }}>{month}</span>
                      <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(amount)}</span>
                    </div>
                    <div style={{ width: "100%", height: 6, borderRadius: 99, background: BORDER }}>
                      <div style={{
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 99,
                        background: month === "Reserve" ? GOLD : NAVY,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 10, paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Key Line Items
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {CAPITAL_DEPLOYMENT.filter((c) => c.amount >= 5000).map((c) => (
                  <div key={c.category} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: TEXT_DIM, flex: 1 }}>{c.category}</span>
                    <span style={{ color: NAVY, fontWeight: 600, marginLeft: 8 }}>{fmtDollar(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Founder Capital */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Founder Capital (Pre-Raise)</div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>2025 Capital</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(FOUNDER_CAPITAL_2025)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Jan-Feb 2026</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(FOUNDER_CAPITAL_2026_YTD)}</span>
              </div>
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: NAVY, fontWeight: 700 }}>Total Founder Capital</span>
                <span style={{ color: NAVY, fontWeight: 800 }}>{fmtDollar(FOUNDER_CAPITAL_TOTAL)}</span>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Breakdown</div>
              <div style={{ display: "grid", gap: 3 }}>
                {CAPITAL_TO_DATE.map((c) => (
                  <div key={`${c.category}-${c.period}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: TEXT_DIM }}>{c.category} ({c.period})</span>
                    <span style={{ color: NAVY, fontWeight: 600 }}>{fmtDollar(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.7fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Recent Transactions (30d)</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Date</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Description</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Amount</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {(tx?.transactions || []).slice(0, 12).map((item) => (
                  <tr key={item.transactionId}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", fontSize: 12, color: TEXT_DIM }}>{item.date}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", fontSize: 13, color: NAVY, fontWeight: 600 }}>
                      {item.merchantName || item.name}
                    </td>
                    <td
                      style={{
                        borderTop: `1px solid ${BORDER}`,
                        padding: "8px 0",
                        fontSize: 13,
                        textAlign: "right",
                        color: item.amount > 0 ? RED : "#166534",
                        fontWeight: 700,
                      }}
                    >
                      {item.amount > 0 ? "-" : "+"}
                      {fmtDollar(Math.abs(item.amount))}
                    </td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", fontSize: 12, color: TEXT_DIM }}>
                      {item.category?.[0] || "Uncategorized"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {txLoading ? <div style={{ marginTop: 8, fontSize: 12, color: TEXT_DIM }}>Loading transactions...</div> : null}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Cash Projection (90d)</div>

          {forecastLoading && forecastChart.length === 0 ? (
            <SkeletonChart height={190} />
          ) : (
            <div style={{ width: "100%", height: 190 }}>
              <ResponsiveContainer>
                <LineChart data={forecastChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: TEXT_DIM }} />
                  <YAxis tick={{ fontSize: 10, fill: TEXT_DIM }} />
                  <Tooltip formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))} />
                  <Line type="monotone" dataKey="balance" stroke={NAVY} strokeWidth={2.2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: TEXT_DIM }}>Current balance</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(forecast?.currentBalance || 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: TEXT_DIM }}>Projected runway</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{forecast?.runway || 0} days</span>
            </div>
          </div>

          {(forecast?.alerts || []).length > 0 ? (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER}`, display: "grid", gap: 6 }}>
              {(forecast?.alerts || []).slice(0, 2).map((alert, idx) => (
                <div key={idx} style={{ color: RED, fontSize: 12, fontWeight: 600 }}>
                  {alert}
                </div>
              ))}
            </div>
          ) : null}

          {forecastLoading ? <div style={{ marginTop: 8, fontSize: 12, color: TEXT_DIM }}>Loading forecast...</div> : null}
        </div>
      </div>

      {(pnlLoading || balLoading) && !hasError ? (
        <div style={{ fontSize: 12, color: TEXT_DIM }}>Refreshing finance metrics...</div>
      ) : null}
    </div>
  );
}
