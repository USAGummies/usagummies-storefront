"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  useInventoryData,
  comparePlanVsActual,
  fmtDollar,
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
import { RefreshButton } from "@/app/ops/components/RefreshButton";
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

const COLOR_AMAZON = "#f59e0b";
const COLOR_DTC = "#3b82f6";
const COLOR_FAIRE = "#10b981";
const COLOR_DIST = "#ef4444";
const ABRA_INSIGHTS_PROMPT =
  "Give me 3 bullet-point business highlights for today based on recent emails and brain data. Focus on: revenue trends, pipeline activity, and any urgent items.";

type AbraSource = {
  id: string;
  source_table: "brain" | "email";
  title: string;
  similarity: number;
};

type EmailSignalBucket = {
  signal_type: string;
  count: number;
  critical: number;
  warning: number;
  info: number;
};

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
            {variance.status === "no-data"
              ? "N/A"
              : `${(variance.variancePct * 100).toFixed(1)}%`}
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
  const { data: channels, error: channelsError } = useChannelData();
  const { data: pnl } = usePnLData();
  const { data: inventory } = useInventoryData();
  const [abraInsights, setAbraInsights] = useState<string>("");
  const [abraSources, setAbraSources] = useState<AbraSource[]>([]);
  const [abraLoading, setAbraLoading] = useState<boolean>(false);
  const [abraError, setAbraError] = useState<string | null>(null);
  const [emailSignals, setEmailSignals] = useState<EmailSignalBucket[]>([]);
  const [emailSignalsTotal, setEmailSignalsTotal] = useState(0);
  const [emailSignalsLoading, setEmailSignalsLoading] = useState(false);

  const fetchAbraInsights = useCallback(async () => {
    setAbraLoading(true);
    setAbraError(null);
    try {
      const res = await fetch("/api/ops/abra/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: ABRA_INSIGHTS_PROMPT,
          history: [],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(message);
      }

      setAbraInsights(typeof data?.reply === "string" ? data.reply : "");
      setAbraSources(Array.isArray(data?.sources) ? (data.sources as AbraSource[]) : []);
    } catch (error) {
      setAbraError(error instanceof Error ? error.message : "Failed to load Abra insights");
      setAbraInsights("");
      setAbraSources([]);
    } finally {
      setAbraLoading(false);
    }
  }, []);

  const fetchEmailSignals = useCallback(async () => {
    setEmailSignalsLoading(true);
    try {
      const res = await fetch("/api/ops/abra/email-signals", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `HTTP ${res.status}`,
        );
      }
      const buckets = Array.isArray(data?.by_type)
        ? (data.by_type as EmailSignalBucket[])
        : [];
      setEmailSignals(buckets);
      setEmailSignalsTotal(Number(data?.total || 0));
    } catch {
      setEmailSignals([]);
      setEmailSignalsTotal(0);
    } finally {
      setEmailSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAbraInsights();
    void fetchEmailSignals();
  }, [fetchAbraInsights, fetchEmailSignals]);

  const month = getCurrentProFormaMonth();
  const planRevenue = month ? cumulativeThrough(TOTAL_REVENUE, month) : null;
  const planUnits = month ? cumulativeThrough(TOTAL_UNITS, month) : null;
  const planEbitda = month ? cumulativeThrough(EBITDA, month) : null;
  // Pro-forma GROSS_MARGIN values are decimals (0.375 = 37.5%).
  // P&L API returns grossMargin as a percentage (37.5 = 37.5%).
  // Convert plan to percentage scale so both are comparable.
  const planMarginDecimal = month
    ? average(getMonthsThrough(month).map((m) => GROSS_MARGIN[m]))
    : null;
  const planMargin = planMarginDecimal != null ? planMarginDecimal * 100 : null;

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

  // Only count leads in active engagement stages — not cold outreach, not closed.
  // "Open Deals" means actual conversations in progress, not every email we've sent.
  const ACTIVE_DEAL_STAGES = /interested|quote sent|negotiation|proposal sent|order placed/i;
  const openDeals = useMemo(() => {
    if (!pipeline) return 0;
    return Object.entries(pipeline.stageCounts || {}).reduce((sum, [stage, count]) => {
      return ACTIVE_DEAL_STAGES.test(stage) ? sum + count : sum;
    }, 0);
  }, [pipeline]);

  const inventoryDays = inventory?.summary?.avgDaysOfSupply ?? 0;

  // Compute sell-out dates per location from inventory items
  const sellOutTimeline = useMemo(() => {
    const items = inventory?.items || [];
    if (items.length === 0) return [];
    const now = new Date();
    return items
      .filter((item) => item.currentStock > 0 && item.daysOfSupply > 0 && item.daysOfSupply < 999)
      .map((item) => {
        const sellOutDate = new Date(now.getTime() + item.daysOfSupply * 86_400_000);
        return {
          location: item.location || "Unknown",
          stock: item.currentStock,
          velocity: item.dailyVelocity,
          daysLeft: Math.round(item.daysOfSupply),
          sellOutDate,
          sellOutLabel: sellOutDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          urgent: item.daysOfSupply < 14,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [inventory]);

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

    // If channels API returned no Shopify breakdown but dashboard has Shopify revenue,
    // show it as "Shopify" so the donut isn't Amazon-only.
    const shopifyTotal = dtc + faire + distributor;
    const dashboardShopify = dashboard?.shopify?.totalRevenue || 0;
    const useFallback = shopifyTotal === 0 && dashboardShopify > 0;

    const items = useFallback
      ? [
          { name: "Amazon", value: amazon, color: COLOR_AMAZON },
          { name: "Shopify", value: dashboardShopify, color: COLOR_DTC },
        ]
      : [
          { name: "Amazon", value: amazon, color: COLOR_AMAZON },
          { name: "DTC", value: dtc, color: COLOR_DTC },
          { name: "Faire", value: faire, color: COLOR_FAIRE },
          { name: "Distributor", value: distributor, color: COLOR_DIST },
        ];

    return items.filter((x) => x.value > 0);
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
    { label: "Inventory", timestamp: inventory?.generatedAt },
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
        <RefreshButton loading={dashboardLoading} onClick={() => refresh()} />
      </div>

      {(dashboardError || channelsError) ? (
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
          {dashboardError || channelsError}
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
          label={
            balances?.cashSource === "manual"
              ? "Cash Position (Manual)"
              : balances?.cashSource === "plaid-live"
                ? "Cash Position (Plaid)"
                : "Cash Position"
          }
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
          value={`${(marginActual || 0).toFixed(1)}%`}
          plan={planMargin != null ? `${planMargin.toFixed(1)}%` : null}
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
          label={sellOutTimeline.length > 0
            ? `Inventory → ${sellOutTimeline[0].sellOutLabel}`
            : "Days of Inventory"
          }
          value={`${inventoryDays.toFixed(0)}d`}
          plan="30d"
          variance={comparePlanVsActual(30, inventoryDays)}
          spark={sparkInventory.length ? sparkInventory : [0, 0, 0]}
        />
      </div>

      <div
        style={{
          background: BG,
          border: `1px solid ${NAVY}33`,
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 14,
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{"\u{1F9E0}"}</span>
            <div style={{ color: NAVY, fontWeight: 800, fontSize: 14, letterSpacing: "0.02em" }}>Abra Insights</div>
          </div>
          <button
            onClick={() => void fetchAbraInsights()}
            disabled={abraLoading}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              background: "white",
              color: NAVY,
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 10px",
              cursor: abraLoading ? "wait" : "pointer",
              opacity: abraLoading ? 0.7 : 1,
            }}
          >
            {abraLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {abraLoading ? (
          <div
            style={{
              fontSize: 13,
              color: TEXT_DIM,
              animation: "abraPulse 1.2s ease-in-out infinite",
            }}
          >
            Abra is analyzing...
          </div>
        ) : abraError ? (
          <div style={{ fontSize: 13, color: RED, fontWeight: 700 }}>
            {abraError}
          </div>
        ) : (
          <div style={{ color: NAVY, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {abraInsights || "No insights returned."}
          </div>
        )}

        {!abraLoading && !abraError && abraSources.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {abraSources.map((source) => (
              <span
                key={`dashboard-source-${source.id}`}
                title={source.title}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: NAVY,
                  border: `1px solid ${BORDER}`,
                  background: "#fff",
                  borderRadius: 999,
                  padding: "4px 8px",
                }}
              >
                <strong style={{ color: source.source_table === "email" ? RED : NAVY }}>
                  {source.source_table.toUpperCase()}
                </strong>
                <span
                  style={{
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {source.title}
                </span>
                <span style={{ color: TEXT_DIM }}>
                  {Number(source.similarity || 0).toFixed(2)}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Sell-Out Timeline ── */}
      {sellOutTimeline.length > 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: 15 }}>📅 Estimated Sell-Out Dates</div>
            <span style={{ fontSize: 11, color: TEXT_DIM }}>Based on current sales velocity</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sellOutTimeline.length, 4)}, 1fr)`, gap: 10 }}>
            {sellOutTimeline.map((loc) => (
              <div
                key={loc.location}
                style={{
                  background: loc.urgent ? `${RED}0a` : `${NAVY}08`,
                  border: `1px solid ${loc.urgent ? `${RED}30` : BORDER}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  {loc.location}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: loc.urgent ? RED : NAVY }}>
                  {loc.sellOutLabel}
                </div>
                <div style={{ fontSize: 12, color: loc.urgent ? RED : TEXT_DIM, fontWeight: loc.urgent ? 700 : 400, marginTop: 2 }}>
                  {loc.daysLeft}d remaining • {loc.velocity}/day
                </div>
                <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 1 }}>
                  {loc.stock.toLocaleString()} units on hand
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
          {dashboardLoading && trendRows.length === 0 ? (
            <SkeletonChart height={280} />
          ) : (
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
          )}
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
            <SourceRow label="Cash Source" value={balances?.cashSourceLabel || "Unknown"} />
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

        {dashboardLoading && (alerts?.alerts || []).length === 0 ? (
          <SkeletonTable rows={4} />
        ) : (alerts?.alerts || []).length === 0 ? (
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

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: NAVY }}>Email Signals (7d)</div>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>
            {emailSignalsTotal.toLocaleString("en-US")} total
          </div>
        </div>

        {emailSignalsLoading ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Loading email signals...</div>
        ) : emailSignals.length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>No recent email-derived signals.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {emailSignals.slice(0, 8).map((bucket) => (
              <div
                key={bucket.signal_type}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr auto auto auto auto",
                  gap: 10,
                  alignItems: "center",
                  borderTop: `1px solid ${BORDER}`,
                  paddingTop: 8,
                  fontSize: 12,
                }}
              >
                <div style={{ color: NAVY, fontWeight: 700 }}>
                  {bucket.signal_type.replace(/_/g, " ")}
                </div>
                <div style={{ color: TEXT_DIM }}>Total {bucket.count}</div>
                <div style={{ color: RED }}>Critical {bucket.critical}</div>
                <div style={{ color: GOLD }}>Warn {bucket.warning}</div>
                <div style={{ color: "#16a34a" }}>Info {bucket.info}</div>
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

      <style jsx>{`
        @keyframes abraPulse {
          0% { opacity: 0.45; }
          50% { opacity: 1; }
          100% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}
