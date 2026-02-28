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
import { Wallet, TrendingUp, Flame, AlertTriangle } from "lucide-react";

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
  getCurrentProFormaMonth,
  getMonthsThrough,
  cumulativeThrough,
} from "@/lib/ops/pro-forma";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
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
