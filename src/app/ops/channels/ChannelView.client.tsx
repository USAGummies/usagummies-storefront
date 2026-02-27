"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  ShoppingCart,
  Store,
  Truck,
  Layers,
} from "lucide-react";
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
  useChannelData,
  useDashboardData,
  usePnLData,
  comparePlanVsActual,
  STATUS_COLORS,
  fmtDollar,
  fmtPercent,
  type ChannelData,
} from "@/lib/ops/use-war-room-data";
import {
  AMAZON,
  WHOLESALE,
  DISTRIBUTOR,
  TOTAL_REVENUE,
  getCurrentProFormaMonth,
  cumulativeThrough,
} from "@/lib/ops/pro-forma";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const BG = "#f8f5ef";
const CARD = "#ffffff";
const BORDER = "rgba(27,42,74,0.08)";
const TEXT_DIM = "rgba(27,42,74,0.56)";

const COLOR_DTC = "#3b82f6";
const COLOR_AMAZON = "#f59e0b";
const COLOR_FAIRE = "#10b981";
const COLOR_DIST = "#ef4444";

const TABS = [
  { key: "all", label: "All Channels", icon: Layers },
  { key: "dtc", label: "Shopify DTC", icon: ShoppingCart },
  { key: "amazon", label: "Amazon", icon: Store },
  { key: "faire", label: "Faire", icon: TrendingUp },
  { key: "distributor", label: "Distributors", icon: Truck },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function safePct(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function estimateMargin(
  key: TabKey,
  grossMargin: number,
  data: ChannelData | null,
): number {
  if (key === "all") return clamp(grossMargin, 0, 1);
  if (key === "amazon") {
    if (data?.amazon?.fees?.estimatedNetMargin != null) {
      return clamp(data.amazon.fees.estimatedNetMargin, 0, 1);
    }
    return clamp(grossMargin - 0.04, 0, 1);
  }
  if (key === "dtc") return clamp(grossMargin - 0.03, 0, 1);
  if (key === "faire") return clamp(grossMargin - 0.08, 0, 1);
  return clamp(grossMargin - 0.1, 0, 1);
}

function getPlanToDate(key: TabKey): number | null {
  const month = getCurrentProFormaMonth();
  if (!month) return null;

  const amazonPlan = cumulativeThrough(AMAZON.revenue, month);
  const wholesalePlan = cumulativeThrough(WHOLESALE.revenue, month);
  const distributorPlan = cumulativeThrough(DISTRIBUTOR.revenue, month);
  const allPlan = cumulativeThrough(TOTAL_REVENUE, month);

  if (key === "all") return allPlan;
  if (key === "amazon") return amazonPlan;
  if (key === "faire") return wholesalePlan;
  if (key === "distributor") return distributorPlan;
  return null; // no dedicated DTC plan line in pro forma
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: TEXT_DIM,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{hint}</div> : null}
    </div>
  );
}

export function ChannelView() {
  const [tab, setTab] = useState<TabKey>("all");

  const { data: channels, loading, error, refresh } = useChannelData();
  const { data: dashboard } = useDashboardData();
  const { data: pnl } = usePnLData();

  const stats = useMemo(() => {
    const amazonRevenue = channels?.amazon?.revenue ?? 0;
    const amazonOrders = channels?.amazon?.orders ?? 0;

    const dtcRevenue = channels?.shopify?.dtc.revenue ?? 0;
    const dtcOrders = channels?.shopify?.dtc.orders ?? 0;

    const faireRevenue = channels?.shopify?.faire.revenue ?? 0;
    const faireOrders = channels?.shopify?.faire.orders ?? 0;

    const distRevenue = channels?.shopify?.distributor.revenue ?? 0;
    const distOrders = channels?.shopify?.distributor.orders ?? 0;

    const totalRevenue = amazonRevenue + dtcRevenue + faireRevenue + distRevenue;
    const totalOrders = amazonOrders + dtcOrders + faireOrders + distOrders;

    return {
      all: { revenue: totalRevenue, orders: totalOrders },
      dtc: { revenue: dtcRevenue, orders: dtcOrders },
      amazon: { revenue: amazonRevenue, orders: amazonOrders },
      faire: { revenue: faireRevenue, orders: faireOrders },
      distributor: { revenue: distRevenue, orders: distOrders },
    } as Record<TabKey, { revenue: number; orders: number }>;
  }, [channels]);

  const trendRows = useMemo(() => {
    const daily = channels?.dailyByChannel || [];
    const amazonByDate = new Map(
      (dashboard?.chartData || []).map((d) => [d.date, d.amazon]),
    );

    return daily.map((d) => {
      const amazon = amazonByDate.get(d.date) || 0;
      return {
        date: d.date,
        label: d.label,
        dtc: d.dtcRevenue,
        faire: d.faireRevenue,
        distributor: d.distributorRevenue,
        amazon,
        total: d.totalRevenue + amazon,
      };
    });
  }, [channels, dashboard]);

  const mixRows = useMemo(() => {
    return [
      { name: "Amazon", value: stats.amazon.revenue, color: COLOR_AMAZON },
      { name: "Shopify DTC", value: stats.dtc.revenue, color: COLOR_DTC },
      { name: "Faire", value: stats.faire.revenue, color: COLOR_FAIRE },
      { name: "Distributor", value: stats.distributor.revenue, color: COLOR_DIST },
    ].filter((r) => r.value > 0);
  }, [stats]);

  const selected = stats[tab];
  const aov = selected.orders > 0 ? selected.revenue / selected.orders : 0;
  const margin = estimateMargin(tab, pnl?.grossMargin || 0, channels);
  const contribution = selected.revenue * margin;

  const plan = getPlanToDate(tab);
  const pva = plan != null ? comparePlanVsActual(plan, selected.revenue) : null;

  const topOrders = useMemo(() => {
    const dtcOrders = channels?.shopify?.dtc.items || [];
    const faireOrders = channels?.shopify?.faire.items || [];
    const distOrders = channels?.shopify?.distributor.items || [];

    let source = [...dtcOrders, ...faireOrders, ...distOrders];
    if (tab === "dtc") source = [...dtcOrders];
    if (tab === "faire") source = [...faireOrders];
    if (tab === "distributor") source = [...distOrders];
    if (tab === "amazon") source = [];

    return source.sort((a, b) => b.total - a.total).slice(0, 10);
  }, [channels, tab]);
  const freshnessItems = [
    { label: "Channels", timestamp: channels?.generatedAt },
    { label: "Dashboard", timestamp: dashboard?.generatedAt },
    { label: "P&L", timestamp: pnl?.generatedAt },
  ];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: NAVY, letterSpacing: "-0.02em" }}>
            Revenue by Channel
          </h1>
          <div style={{ marginTop: 4, color: TEXT_DIM, fontSize: 13 }}>
            Live channel split with Faire separated from Shopify DTC.
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
            background: NAVY,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              style={{
                border: `1px solid ${active ? NAVY : BORDER}`,
                background: active ? NAVY : CARD,
                color: active ? "#fff" : NAVY,
                borderRadius: 10,
                padding: "10px 12px",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                cursor: "pointer",
              }}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            borderRadius: 10,
            border: `1px solid ${RED}40`,
            background: `${RED}12`,
            color: RED,
            padding: "12px 14px",
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <KpiCard label="Revenue (MTD)" value={fmtDollar(selected.revenue)} />
        <KpiCard label="Orders (MTD)" value={selected.orders.toLocaleString("en-US")} />
        <KpiCard label="AOV" value={fmtDollar(aov)} />
        <KpiCard label="Est. Contribution Margin" value={fmtPercent(safePct(margin))} />
        <KpiCard label="Est. Contribution Profit" value={fmtDollar(contribution)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 14px 8px",
            minHeight: 320,
          }}
        >
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>
            30-Day Revenue Trend
          </div>
          <div style={{ width: "100%", height: 270 }}>
            <ResponsiveContainer>
              <ComposedChart data={trendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(27,42,74,0.08)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip
                  formatter={(value: number | string | undefined) =>
                    fmtDollar(Number(value || 0))
                  }
                  contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}` }}
                />
                <Bar dataKey="dtc" stackId="revenue" fill={COLOR_DTC} name="Shopify DTC" />
                <Bar dataKey="faire" stackId="revenue" fill={COLOR_FAIRE} name="Faire" />
                <Bar dataKey="distributor" stackId="revenue" fill={COLOR_DIST} name="Distributor" />
                <Line
                  dataKey="amazon"
                  type="monotone"
                  stroke={COLOR_AMAZON}
                  strokeWidth={2.2}
                  dot={false}
                  name="Amazon"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 14px 8px",
            minHeight: 320,
          }}
        >
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>
            Channel Mix
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={mixRows} dataKey="value" nameKey="name" outerRadius={70} innerRadius={42}>
                  {mixRows.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | string | undefined) =>
                    fmtDollar(Number(value || 0))
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {mixRows.map((row) => {
              const total = stats.all.revenue || 1;
              return (
                <div key={row.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: NAVY }}>
                    <span style={{ color: row.color, marginRight: 6 }}>●</span>
                    {row.name}
                  </span>
                  <span style={{ color: TEXT_DIM, fontWeight: 700 }}>
                    {(row.value / total * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 14px 10px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>
            Top Orders {tab === "amazon" ? "(Amazon unavailable in this table)" : "(Shopify channels)"}
          </div>

          {tab === "amazon" ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>
              Amazon order line-items are sourced separately via SP-API. This table currently shows Shopify-derived channels only.
            </div>
          ) : topOrders.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>{loading ? "Loading..." : "No orders in this view."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Order</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Date</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topOrders.map((order) => (
                    <tr key={order.name + order.createdAt}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 600 }}>
                        {order.name}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {new Date(order.createdAt).toLocaleDateString("en-US")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY, fontWeight: 700 }}>
                        {fmtDollar(order.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 14px 10px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Channel Comparison</div>

          {([
            { label: "Amazon", key: "amazon" as TabKey },
            { label: "Shopify DTC", key: "dtc" as TabKey },
            { label: "Faire", key: "faire" as TabKey },
            { label: "Distributors", key: "distributor" as TabKey },
          ]).map((row) => {
            const rev = stats[row.key].revenue;
            const ord = stats[row.key].orders;
            const channelMargin = estimateMargin(row.key, pnl?.grossMargin || 0, channels);
            return (
              <div key={row.key} style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700, color: NAVY }}>{row.label}</div>
                  <div style={{ color: NAVY, fontWeight: 700 }}>{fmtDollar(rev)}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: TEXT_DIM }}>
                  <span>{ord.toLocaleString("en-US")} orders</span>
                  <span>Est margin {fmtPercent(channelMargin)}</span>
                </div>
              </div>
            );
          })}
        </div>
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
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Plan Benchmark
        </div>

        {pva ? (
          <>
            <div style={{ fontSize: 13, color: NAVY }}>
              Plan {fmtDollar(plan || 0)}
            </div>
            <div style={{ fontSize: 13, color: NAVY }}>
              Actual {fmtDollar(selected.revenue)}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: STATUS_COLORS[pva.status],
                background: `${STATUS_COLORS[pva.status]}14`,
                borderRadius: 6,
                padding: "4px 8px",
              }}
            >
              {pva.variance >= 0 ? "+" : ""}
              {fmtDollar(pva.variance)} ({(pva.variancePct * 100).toFixed(1)}%)
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            No dedicated plan line for this tab yet (DTC currently rolls into wholesale planning).
          </div>
        )}
      </div>
    </div>
  );
}
