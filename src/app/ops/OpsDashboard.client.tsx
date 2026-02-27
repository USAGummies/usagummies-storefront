"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  RefreshCw,
  AlertTriangle,
  DollarSign,
  Wallet,
  Package,
  Percent,
  Briefcase,
  Boxes,
} from "lucide-react";

import {
  useDashboardData,
  useBalancesData,
  usePipelineData,
  useAlerts,
  useChannelData,
  usePnLData,
  comparePlanVsActual,
  fmtDollar,
  fmtPercent,
  STATUS_COLORS,
} from "@/lib/ops/use-war-room-data";
import {
  TOTAL_REVENUE,
  TOTAL_UNITS,
  EBITDA,
  GROSS_MARGIN,
  getCurrentProFormaMonth,
  getMonthsThrough,
  cumulativeThrough,
} from "@/lib/ops/pro-forma";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";

const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const BG = "#f8f5ef";
const CARD = "#ffffff";
const BORDER = "rgba(27,42,74,0.08)";
const TEXT_DIM = "rgba(27,42,74,0.56)";

const COLOR_AMAZON = "#f59e0b";
const COLOR_DTC = "#3b82f6";
const COLOR_FAIRE = "#10b981";
const COLOR_DIST = "#ef4444";

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 30 }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

function MetricCard({
  icon,
  label,
  value,
  plan,
  variance,
  spark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  plan: string | null;
  variance: ReturnType<typeof comparePlanVsActual> | null;
  spark: number[];
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 14px 10px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: NAVY }}>{icon}</span>
          <span
            style={{
              fontSize: 11,
              color: TEXT_DIM,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 27, fontWeight: 800, color: NAVY }}>{value}</div>

      <Sparkline values={spark} color={NAVY} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <span style={{ color: TEXT_DIM }}>
          Plan: {plan ?? "N/A"}
        </span>
        {variance ? (
          <span
            style={{
              color: STATUS_COLORS[variance.status],
              background: `${STATUS_COLORS[variance.status]}14`,
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 800,
            }}
          >
            {(variance.variancePct * 100).toFixed(1)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: TEXT_DIM }}>{label}</span>
      <span style={{ color: NAVY, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export function OpsDashboard() {
  const { data: dashboard, loading: dashboardLoading, error: dashboardError, refresh } = useDashboardData();
  const { data: balances } = useBalancesData();
  const { data: pipeline } = usePipelineData();
  const { data: alerts } = useAlerts(5);
  const { data: channels } = useChannelData();
  const { data: pnl } = usePnLData();

  const month = getCurrentProFormaMonth();
  const planRevenue = month ? cumulativeThrough(TOTAL_REVENUE, month) : null;
  const planUnits = month ? cumulativeThrough(TOTAL_UNITS, month) : null;
  const planEbitda = month ? cumulativeThrough(EBITDA, month) : null;
  const planMargin = month
    ? average(getMonthsThrough(month).map((m) => GROSS_MARGIN[m]))
    : null;

  const revenueActual = dashboard?.combined.totalRevenue ?? null;
  const unitsActual =
    ((dashboard?.amazon?.unitsSold?.monthToDate || 0) +
      (dashboard?.shopify?.totalOrders || 0)) || null;
  const marginActual = pnl?.grossMargin ?? null;
  const ebitdaActual = pnl?.netIncome ?? null;

  const revenuePva = planRevenue != null ? comparePlanVsActual(planRevenue, revenueActual) : null;
  const unitsPva = planUnits != null ? comparePlanVsActual(planUnits, unitsActual) : null;
  const marginPva =
    planMargin != null && marginActual != null
      ? comparePlanVsActual(planMargin, marginActual)
      : null;
  const ebitdaPva = planEbitda != null ? comparePlanVsActual(planEbitda, ebitdaActual) : null;

  const openDeals = useMemo(() => {
    if (!pipeline) return 0;
    const closed = Object.entries(pipeline.stageCounts || {}).reduce((sum, [stage, count]) => {
      return /closed|lost|not interested/i.test(stage) ? sum + count : sum;
    }, 0);
    return Math.max(0, pipeline.totalLeads - closed);
  }, [pipeline]);

  const inventoryDays = dashboard?.amazon?.inventory?.daysOfSupply ?? 0;

  const trendRows = useMemo(() => {
    const channelDaily = channels?.dailyByChannel || [];
    const amazonByDate = new Map((dashboard?.chartData || []).map((d) => [d.date, d.amazon]));
    if (channelDaily.length === 0) {
      return (dashboard?.chartData || []).map((d) => ({
        label: d.label,
        amazon: d.amazon,
        dtc: d.shopify,
        faire: 0,
        distributor: 0,
      }));
    }

    return channelDaily.map((d) => ({
      label: d.label,
      amazon: amazonByDate.get(d.date) || 0,
      dtc: d.dtcRevenue,
      faire: d.faireRevenue,
      distributor: d.distributorRevenue,
    }));
  }, [channels, dashboard]);

  const channelMix = useMemo(() => {
    const amazon = dashboard?.amazon?.revenue.monthToDate || 0;
    const dtc = channels?.shopify?.dtc.revenue || 0;
    const faire = channels?.shopify?.faire.revenue || 0;
    const distributor = channels?.shopify?.distributor.revenue || 0;

    return [
      { name: "Amazon", value: amazon, color: COLOR_AMAZON },
      { name: "DTC", value: dtc, color: COLOR_DTC },
      { name: "Faire", value: faire, color: COLOR_FAIRE },
      { name: "Distributor", value: distributor, color: COLOR_DIST },
    ].filter((x) => x.value > 0);
  }, [channels, dashboard]);

  const sparkRevenue = (dashboard?.chartData || []).map((d) => d.combined);
  const sparkCash = balances
    ? [
        balances.found?.available || 0,
        balances.shopify?.balance || 0,
        balances.amazon?.pendingBalance || 0,
        balances.totalCash,
      ]
    : [0, 0, 0, 0];
  const sparkUnits = (dashboard?.chartData || []).map((d) => d.combinedOrders);
  const sparkDeals = Object.values(pipeline?.stageCounts || {});
  const sparkInventory = (dashboard?.amazon?.dailyBreakdown || []).map((d) => d.orders);
  const freshnessItems = [
    { label: "Dashboard", timestamp: dashboard?.generatedAt },
    { label: "Balances", timestamp: balances?.lastUpdated },
    { label: "Pipeline", timestamp: pipeline?.generatedAt },
    { label: "Alerts", timestamp: alerts?.lastFetched },
    { label: "Channels", timestamp: channels?.generatedAt },
  ];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
            Command Center
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Live operational overview with channel, finance, and alert visibility.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <button
          onClick={() => refresh()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "none",
            borderRadius: 8,
            background: NAVY,
            color: "#fff",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {dashboardError ? (
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
          {dashboardError}
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
        <MetricCard
          icon={<DollarSign size={16} />}
          label="MTD Revenue"
          value={fmtDollar(revenueActual || 0)}
          plan={planRevenue != null ? fmtDollar(planRevenue) : null}
          variance={revenuePva}
          spark={sparkRevenue.length ? sparkRevenue : [0, 0, 0]}
        />
        <MetricCard
          icon={<Wallet size={16} />}
          label="Cash Position"
          value={fmtDollar(balances?.totalCash || 0)}
          plan={null}
          variance={null}
          spark={sparkCash}
        />
        <MetricCard
          icon={<Package size={16} />}
          label="Units Shipped"
          value={(unitsActual || 0).toLocaleString("en-US")}
          plan={planUnits != null ? planUnits.toLocaleString("en-US") : null}
          variance={unitsPva}
          spark={sparkUnits.length ? sparkUnits : [0, 0, 0]}
        />
        <MetricCard
          icon={<Percent size={16} />}
          label="Contribution Margin"
          value={fmtPercent(marginActual || 0)}
          plan={planMargin != null ? fmtPercent(planMargin) : null}
          variance={marginPva}
          spark={sparkRevenue.length ? sparkRevenue : [0, 0, 0]}
        />
        <MetricCard
          icon={<Briefcase size={16} />}
          label="Open Deals"
          value={openDeals.toLocaleString("en-US")}
          plan={null}
          variance={null}
          spark={sparkDeals.length ? sparkDeals : [0, 0, 0]}
        />
        <MetricCard
          icon={<Boxes size={16} />}
          label="Days of Inventory"
          value={`${inventoryDays.toFixed(0)}d`}
          plan="30d"
          variance={comparePlanVsActual(30, inventoryDays)}
          spark={sparkInventory.length ? sparkInventory : [0, 0, 0]}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 14px 8px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>30-Day Revenue by Channel</div>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))} />
                <Bar dataKey="amazon" stackId="rev" fill={COLOR_AMAZON} name="Amazon" />
                <Bar dataKey="dtc" stackId="rev" fill={COLOR_DTC} name="DTC" />
                <Bar dataKey="faire" stackId="rev" fill={COLOR_FAIRE} name="Faire" />
                <Bar dataKey="distributor" stackId="rev" fill={COLOR_DIST} name="Distributor" />
                <Line
                  type="monotone"
                  dataKey={() => {
                    if (!month) return 0;
                    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
                    return TOTAL_REVENUE[month] / daysInMonth;
                  }}
                  stroke={NAVY}
                  strokeDasharray="5 4"
                  dot={false}
                  name="Daily Plan"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 14px 8px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Channel Mix</div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={channelMix} dataKey="value" nameKey="name" outerRadius={70} innerRadius={42}>
                  {channelMix.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gap: 7 }}>
            {channelMix.map((row) => {
              const total = dashboard?.combined.totalRevenue || 1;
              return (
                <SourceRow
                  key={row.name}
                  label={`${row.name} (${((row.value / total) * 100).toFixed(1)}%)`}
                  value={fmtDollar(row.value)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Cash Position Summary</div>
          <div style={{ display: "grid", gap: 8 }}>
            <SourceRow label="Found Available" value={fmtDollar(balances?.found?.available || 0)} />
            <SourceRow label="Shopify Pending" value={fmtDollar(balances?.shopify?.balance || 0)} />
            <SourceRow label="Amazon Pending" value={fmtDollar(balances?.amazon?.pendingBalance || 0)} />
            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 8 }}>
              <SourceRow label="Total Cash" value={fmtDollar(balances?.totalCash || 0)} />
            </div>
          </div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Pipeline Snapshot</div>
          <div style={{ display: "grid", gap: 8 }}>
            <SourceRow label="Total Leads" value={String(pipeline?.totalLeads || 0)} />
            <SourceRow label="Open Deals" value={String(openDeals)} />
            <SourceRow label="Pipeline Value" value={fmtDollar(pipeline?.pipelineValue.total || 0)} />
            <SourceRow label="Avg Days to Close" value={`${pipeline?.velocity.avgDaysToClose || 0}d`} />
          </div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: NAVY }}>Active Alerts</div>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>{(alerts?.summary.total || 0).toLocaleString("en-US")} unresolved</div>
        </div>

        {(alerts?.alerts || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            {dashboardLoading ? "Loading alerts..." : "No active alerts right now."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(alerts?.alerts || []).slice(0, 5).map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  borderTop: `1px solid ${BORDER}`,
                  paddingTop: 8,
                }}
              >
                <span
                  style={{
                    marginTop: 2,
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background:
                      alert.priority === "critical"
                        ? RED
                        : alert.priority === "warning"
                          ? GOLD
                          : "#16a34a",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ color: NAVY, fontSize: 13, fontWeight: 700 }}>{alert.title}</div>
                  <div style={{ fontSize: 12, color: TEXT_DIM }}>{alert.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Plan vs Actual Benchmark
        </div>

        <div style={{ fontSize: 13, color: NAVY }}>Revenue: {fmtDollar(revenueActual || 0)} / {fmtDollar(planRevenue || 0)}</div>
        {revenuePva ? (
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: STATUS_COLORS[revenuePva.status],
              background: `${STATUS_COLORS[revenuePva.status]}14`,
              borderRadius: 6,
              padding: "4px 8px",
            }}
          >
            {(revenuePva.variancePct * 100).toFixed(1)}%
          </div>
        ) : null}

        <div style={{ fontSize: 13, color: NAVY }}>EBITDA proxy: {fmtDollar(ebitdaActual || 0)} / {fmtDollar(planEbitda || 0)}</div>
        {ebitdaPva ? (
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: STATUS_COLORS[ebitdaPva.status],
              background: `${STATUS_COLORS[ebitdaPva.status]}14`,
              borderRadius: 6,
              padding: "4px 8px",
            }}
          >
            {(ebitdaPva.variancePct * 100).toFixed(1)}%
          </div>
        ) : null}
      </div>
    </div>
  );
}
