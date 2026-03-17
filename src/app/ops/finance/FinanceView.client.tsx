"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  Area,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Wallet, TrendingUp, Flame, AlertTriangle, ShoppingCart } from "lucide-react";

import {
  usePnLData,
  useBalancesData,
  useTransactions,
  useForecastData,
  useDashboardData,
  useAmazonProfitability,
  type PnLReport,
  fmtDollar,
  fmtDollarExact,
} from "@/lib/ops/use-war-room-data";
import { useIsMobile } from "@/app/ops/hooks";
import { PlaidConnectButton } from "./PlaidConnectButton.client";
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

type RevenueByChannel = {
  channels: {
    shopify: { revenue: number; orders: number; aov: number; trend: Array<{ date: string; value: number }> };
    amazon: { revenue: number; orders: number; aov: number; trend: Array<{ date: string; value: number }> };
    faire: { revenue: number; orders: number; aov: number; trend: Array<{ date: string; value: number }> };
  };
  total: { revenue: number; orders: number; aov: number };
  period: { start: string; end: string; days: number };
};

type MarginViewResponse = {
  margins?: {
    estimated_cogs_per_unit: number;
    estimated_gross_margin_pct: number;
    revenue: number;
    estimated_cogs: number;
    estimated_gross_profit: number;
  };
};

const CHANNEL_COLORS = {
  shopify: NAVY,
  amazon: RED,
  faire: GOLD,
} as const;

function formatDelta(current: number | null, previous: number | null, opts?: { inverse?: boolean }) {
  if (current == null || previous == null || previous === 0) {
    return { label: "—", color: TEXT_DIM };
  }
  const pct = (current - previous) / previous;
  const sign = pct > 0 ? "+" : "";
  const betterUp = !opts?.inverse;
  const isGood = betterUp ? pct >= 0 : pct <= 0;
  return {
    label: `${sign}${(pct * 100).toFixed(1)}%`,
    color: isGood ? "#16a34a" : RED,
  };
}

function monthBounds(base: Date) {
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIsoDate(start), end: toIsoDate(end) };
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
  const isMobile = useIsMobile();
  const { data: pnl, loading: pnlLoading, error: pnlError } = usePnLData();
  const { data: balances, loading: balLoading, error: balError } = useBalancesData();
  const { data: tx, loading: txLoading, error: txError } = useTransactions(30);
  const { data: forecast, loading: forecastLoading, error: forecastError } = useForecastData();
  const { data: dashboard } = useDashboardData();
  const { data: amzProfit, loading: amzLoading } = useAmazonProfitability();
  const [prevPnl, setPrevPnl] = useState<PnLReport | null>(null);
  const [channelData, setChannelData] = useState<RevenueByChannel | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [marginSnapshot, setMarginSnapshot] = useState<MarginViewResponse["margins"] | null>(null);
  const ap = amzProfit?.profitability;

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const { start, end } = monthBounds(prevMonthDate);
    fetch(`/api/ops/pnl?period=custom&start=${start}&end=${end}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PnLReport | null) => {
        if (!cancelled) setPrevPnl(data);
      })
      .catch(() => {
        if (!cancelled) setPrevPnl(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRevenueByChannel() {
      setChannelLoading(true);
      setChannelError(null);
      try {
        const [channelRes, marginRes] = await Promise.all([
          fetch("/api/ops/abra/revenue-by-channel?days=30", { cache: "no-store" }),
          fetch("/api/ops/abra/finance?view=margins", { cache: "no-store" }),
        ]);

        const channelJson = (await channelRes.json().catch(() => ({}))) as RevenueByChannel & { error?: string };
        const marginJson = (await marginRes.json().catch(() => ({}))) as MarginViewResponse & { error?: string };

        if (!channelRes.ok) throw new Error(channelJson.error || "Failed to load channel revenue");
        if (!cancelled) {
          setChannelData(channelJson);
          setMarginSnapshot(marginJson.margins || null);
        }
      } catch (error) {
        if (!cancelled) {
          setChannelError(error instanceof Error ? error.message : "Failed to load channel revenue");
          setChannelData(null);
        }
      } finally {
        if (!cancelled) setChannelLoading(false);
      }
    }

    void loadRevenueByChannel();
    return () => {
      cancelled = true;
    };
  }, []);

  const burnRate = useMemo(() => {
    const proj = forecast?.projections?.["30d"] || [];
    if (proj.length === 0) return null;
    const totalOut = proj.reduce((sum, d) => sum + d.outflows, 0);
    const totalIn = proj.reduce((sum, d) => sum + d.inflows, 0);
    return (totalOut - totalIn) / proj.length;
  }, [forecast]);

  const forecastChart = (forecast?.projections?.["90d"] || []).map((d) => ({
    date: d.date.slice(5),
    balance: d.closingBalance,
  }));

  const averageSellingPrice =
    dashboard && dashboard.combined.totalOrders > 0
      ? dashboard.combined.totalRevenue / dashboard.combined.totalOrders
      : null;

  const hasError = pnlError || balError || txError || forecastError;
  const freshnessItems = [
    { label: "P&L", timestamp: pnl?.generatedAt },
    { label: "Balances", timestamp: balances?.lastUpdated },
    { label: "Transactions", timestamp: tx?.generatedAt },
    { label: "Forecast", timestamp: forecast?.generatedAt },
  ];

  const pnlRows = [
    {
      label: "Revenue",
      current: pnl?.revenue.total ?? null,
      previous: prevPnl?.revenue.total ?? null,
      inverse: false,
    },
    {
      label: "COGS",
      current: pnl?.cogs.total ?? null,
      previous: prevPnl?.cogs.total ?? null,
      inverse: true,
    },
    {
      label: "Gross Profit",
      current: pnl?.grossProfit ?? null,
      previous: prevPnl?.grossProfit ?? null,
      inverse: false,
    },
    {
      label: "OpEx",
      current: pnl?.opex.total ?? null,
      previous: prevPnl?.opex.total ?? null,
      inverse: true,
    },
    {
      label: "Net Income",
      current: pnl?.netIncome ?? null,
      previous: prevPnl?.netIncome ?? null,
      inverse: false,
    },
  ];

  const channelPie = useMemo(() => {
    if (!channelData) return [];
    return [
      { name: "Shopify", key: "shopify", value: channelData.channels.shopify.revenue },
      { name: "Amazon", key: "amazon", value: channelData.channels.amazon.revenue },
      { name: "Faire/Wholesale", key: "faire", value: channelData.channels.faire.revenue },
    ];
  }, [channelData]);

  const channelTrendRows = useMemo(() => {
    if (!channelData) return [];
    const dateSet = new Set<string>();
    for (const trend of channelData.channels.shopify.trend) dateSet.add(trend.date);
    for (const trend of channelData.channels.amazon.trend) dateSet.add(trend.date);
    for (const trend of channelData.channels.faire.trend) dateSet.add(trend.date);

    const sorted = [...dateSet].sort((a, b) => a.localeCompare(b));
    return sorted.map((date) => {
      const shopify =
        channelData.channels.shopify.trend.find((point) => point.date === date)?.value || 0;
      const amazon =
        channelData.channels.amazon.trend.find((point) => point.date === date)?.value || 0;
      const faire =
        channelData.channels.faire.trend.find((point) => point.date === date)?.value || 0;
      return {
        date,
        day: new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        shopify,
        amazon,
        faire,
      };
    });
  }, [channelData]);

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
          P&L / Finance
        </h1>
        <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
          Live financial metrics from connected systems.
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

      {/* Plaid connect — always show so user can connect or reconnect bank */}
      {!balLoading ? (
        <div style={{ marginBottom: 12 }}>
          <PlaidConnectButton
            onSuccess={() => window.location.reload()}
            reconnect={(balances as Record<string, unknown>)?.cashSource === "plaid-live"}
          />
        </div>
      ) : null}

      {channelError ? (
        <div
          style={{
            border: `1px solid ${RED}33`,
            background: `${RED}0f`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {channelError}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Revenue by Channel (30d)</div>
          {channelLoading && !channelData ? (
            <SkeletonChart height={260} />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "220px 1fr",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div style={{ width: "100%", height: isMobile ? 190 : 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={isMobile ? 62 : 78}
                      innerRadius={isMobile ? 30 : 40}
                      paddingAngle={2}
                    >
                      {channelPie.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={
                            entry.key === "shopify"
                              ? CHANNEL_COLORS.shopify
                              : entry.key === "amazon"
                                ? CHANNEL_COLORS.amazon
                                : CHANNEL_COLORS.faire
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => fmtDollar(Number(value || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {channelPie.map((row) => {
                  const pct =
                    channelData && channelData.total.revenue > 0
                      ? (row.value / channelData.total.revenue) * 100
                      : 0;
                  return (
                    <div key={row.key} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px", background: BG }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: NAVY, fontSize: 13, fontWeight: 700 }}>
                          {row.name}
                        </span>
                        <span style={{ color: TEXT_DIM, fontSize: 12 }}>{pct.toFixed(1)}%</span>
                      </div>
                      <div style={{ marginTop: 4, color: NAVY, fontSize: 15, fontWeight: 800 }}>
                        {fmtDollar(row.value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Margin Snapshot <span style={{ fontSize: 10, fontWeight: 400, color: TEXT_DIM }}>(Shopify DTC only)</span></div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Shopify DTC Gross Margin</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {marginSnapshot ? `${marginSnapshot.estimated_gross_margin_pct.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>COGS per unit</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {marginSnapshot ? fmtDollarExact(marginSnapshot.estimated_cogs_per_unit) : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Estimated gross profit</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {marginSnapshot ? fmtDollar(marginSnapshot.estimated_gross_profit) : "—"}
                </span>
              </div>
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, fontSize: 12, color: TEXT_DIM }}>
                Revenue base: {marginSnapshot ? fmtDollar(marginSnapshot.revenue) : "—"}
              </div>
            </div>
          </div>

          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
            <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Cash Position</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Current cash</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {balances?.totalCash != null ? fmtDollar(balances.totalCash) : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Burn rate (daily)</span>
                <span style={{ color: burnRate != null && burnRate > 0 ? RED : NAVY, fontWeight: 700 }}>
                  {burnRate != null ? fmtDollar(burnRate) : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Runway estimate</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>
                  {forecast?.runway != null ? `${forecast.runway} days` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Channel Revenue Trend (30d)</div>
        {channelLoading && !channelData ? (
          <SkeletonChart height={280} />
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={channelTrendRows}>
                <CartesianGrid stroke={BORDER} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}`} />
                <Tooltip formatter={(value, key) => [fmtDollar(Number(value || 0)), String(key)]} />
                <Area type="monotone" dataKey="shopify" stackId="revenue" stroke={CHANNEL_COLORS.shopify} fill={CHANNEL_COLORS.shopify} fillOpacity={0.18} />
                <Area type="monotone" dataKey="amazon" stackId="revenue" stroke={CHANNEL_COLORS.amazon} fill={CHANNEL_COLORS.amazon} fillOpacity={0.18} />
                <Area type="monotone" dataKey="faire" stackId="revenue" stroke={CHANNEL_COLORS.faire} fill={CHANNEL_COLORS.faire} fillOpacity={0.18} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

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
          value={balances?.totalCash != null ? fmtDollar(balances.totalCash) : "—"}
          hint="Found + Shopify + Amazon"
          icon={<Wallet size={16} />}
        />
        <HeaderCard
          label="Daily Burn Rate"
          value={burnRate != null ? fmtDollar(burnRate) : "—"}
          hint="30d projected average"
          icon={<Flame size={16} />}
        />
        <HeaderCard
          label="Runway"
          value={forecast?.runway != null ? `${forecast.runway} days` : "—"}
          hint="Days until cash floor"
          icon={<TrendingUp size={16} />}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1.7fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 12 }}>
            Contribution P&L (Current vs Previous Month)
            {!pnl?.revenue.total && (
              <span style={{ fontSize: 11, color: GOLD, fontWeight: 600, marginLeft: 8 }}>
                — Actuals awaiting Plaid
              </span>
            )}
          </div>

          {pnlLoading && !pnl ? (
            <SkeletonTable rows={6} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Line Item</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Current</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Previous Month</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlRows.map((row) => {
                    const delta = formatDelta(row.current, row.previous, { inverse: row.inverse });
                    return (
                    <tr key={row.label}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", color: NAVY, fontWeight: 700 }}>{row.label}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: NAVY }}>
                        {row.current != null ? fmtDollar(row.current) : <span style={{ color: TEXT_DIM }}>—</span>}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: TEXT_DIM }}>
                        {row.previous != null ? fmtDollar(row.previous) : "—"}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "9px 0", textAlign: "right", color: delta.color, fontWeight: 700 }}>
                        {delta.label}
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Unit Economics</div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Avg selling price</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>
                {averageSellingPrice != null ? fmtDollar(averageSellingPrice) : <span style={{ color: TEXT_DIM }}>—</span>}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Blended Gross Margin <span style={{ fontSize: 10 }}>(all channels)</span></span>
              <span style={{ color: NAVY, fontWeight: 700 }}>
                {pnl?.grossMargin != null ? `${pnl.grossMargin.toFixed(1)}%` : <span style={{ color: TEXT_DIM }}>—</span>}
              </span>
            </div>
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
              <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 6 }}>Channel GP / unit</div>
              <div style={{ display: "grid", gap: 5, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Amazon</span>
                  <span style={{ color: ap ? (ap.profitPerUnit < 0 ? RED : NAVY) : NAVY, fontWeight: 700 }}>
                    {ap ? fmtDollarExact(ap.profitPerUnit) : <span style={{ color: TEXT_DIM }}>—</span>}
                    {ap && <span style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 500 }}> (live)</span>}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Shopify revenue</span>
                  <span style={{ color: NAVY, fontWeight: 700 }}>
                    {dashboard?.shopify?.totalRevenue != null ? fmtDollar(dashboard.shopify.totalRevenue) : <span style={{ color: TEXT_DIM }}>—</span>}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: TEXT_DIM }}>Amazon revenue</span>
                  <span style={{ color: NAVY, fontWeight: 700 }}>
                    {dashboard?.amazon?.revenue?.monthToDate != null ? fmtDollar(dashboard.amazon.revenue.monthToDate) : <span style={{ color: TEXT_DIM }}>—</span>}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Amazon Channel Profitability (LIVE from SP-API) ────── */}
      <div
        style={{
          background: CARD,
          border: `1px solid ${ap && ap.netProfit < 0 ? RED + "55" : BORDER}`,
          borderRadius: 12,
          padding: "14px",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ShoppingCart size={16} color={ap && ap.netProfit < 0 ? RED : NAVY} />
          <div style={{ fontWeight: 700, color: NAVY }}>
            Amazon Channel Profitability
            <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 8, color: TEXT_DIM }}>
              (Live SP-API · Last 30 Days)
            </span>
          </div>
          {ap?.source === "cached" && (
            <span style={{ fontSize: 10, color: TEXT_DIM, background: BORDER, borderRadius: 6, padding: "2px 6px" }}>
              CACHED
            </span>
          )}
        </div>

        {amzLoading && !ap ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Loading Amazon profitability data...</div>
        ) : !ap ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Amazon profitability data unavailable</div>
        ) : (
          <>
            {/* Alert banner if losing money */}
            {ap.netProfit < 0 && (
              <div
                style={{
                  border: `1px solid ${RED}33`,
                  background: `${RED}14`,
                  color: RED,
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 12,
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                Amazon is losing {fmtDollarExact(Math.abs(ap.profitPerUnit))}/unit — every order is unprofitable.
                Breakeven price: {fmtDollarExact(ap.breakeven.breakevenPrice)} (current: {fmtDollarExact(ap.avgSellingPrice)})
              </div>
            )}

            {/* Top metric cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                { label: "Orders", value: String(ap.totalOrders) },
                { label: "Units Sold", value: String(ap.totalUnits) },
                { label: "Avg Price", value: fmtDollarExact(ap.avgSellingPrice) },
                { label: "Net Revenue", value: fmtDollarExact(ap.netRevenue) },
                {
                  label: "Net Profit",
                  value: fmtDollarExact(ap.netProfit),
                  color: ap.netProfit < 0 ? RED : "#16a34a",
                },
                {
                  label: "Per Unit",
                  value: fmtDollarExact(ap.profitPerUnit),
                  color: ap.profitPerUnit < 0 ? RED : "#16a34a",
                },
              ].map((m) => (
                <div
                  key={m.label}
                  style={{
                    background: BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontSize: 10, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "color" in m && m.color ? m.color : NAVY }}>
                    {m.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Two-column: Unit Economics Waterfall + Breakeven */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {/* Waterfall */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Unit Economics Waterfall
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {[
                    { label: "Selling price", value: ap.avgSellingPrice, sign: "" },
                    { label: "Promotions", value: -ap.promotions / Math.max(ap.totalUnits, 1), sign: "-" },
                    { label: "Referral fee", value: -ap.feesPerUnit.referral, sign: "-" },
                    { label: "FBA fee", value: -ap.feesPerUnit.fba, sign: "-" },
                    { label: "COGS", value: -ap.cogsPerUnit, sign: "-" },
                    { label: "Inbound ship", value: -ap.inboundPerUnit, sign: "-" },
                  ].map((row) => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: TEXT_DIM }}>{row.sign} {row.label}</span>
                      <span style={{ color: row.value < 0 ? RED : NAVY, fontWeight: 600 }}>
                        {row.value < 0 ? "-" : ""}${Math.abs(row.value).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 4, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: NAVY, fontWeight: 800 }}>= Net Profit/Unit</span>
                    <span style={{ color: ap.profitPerUnit < 0 ? RED : "#16a34a", fontWeight: 800 }}>
                      {fmtDollarExact(ap.profitPerUnit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Breakeven Analysis */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Breakeven Analysis
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: TEXT_DIM }}>Current price</span>
                    <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollarExact(ap.breakeven.currentPrice)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: RED, fontWeight: 600 }}>Breakeven price</span>
                    <span style={{ color: RED, fontWeight: 800 }}>{fmtDollarExact(ap.breakeven.breakevenPrice)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: TEXT_DIM }}>15% margin target</span>
                    <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollarExact(ap.breakeven.targetPrice15Margin)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: TEXT_DIM }}>25% margin target</span>
                    <span style={{ color: NAVY, fontWeight: 700 }}>{fmtDollarExact(ap.breakeven.targetPrice25Margin)}</span>
                  </div>
                  <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6, marginTop: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: TEXT_DIM }}>Amazon fee % of price</span>
                      <span style={{ color: RED, fontWeight: 700 }}>{ap.breakeven.feePercentOfPrice}%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
                      <span style={{ color: TEXT_DIM }}>Amazon Net Margin <span style={{ fontSize: 10 }}>(after all costs)</span></span>
                      <span style={{ color: ap.netMargin < 0 ? RED : "#16a34a", fontWeight: 700 }}>{ap.netMargin.toFixed(1)}%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
                      <span style={{ color: TEXT_DIM }}>Price gap to breakeven</span>
                      <span style={{ color: RED, fontWeight: 800 }}>
                        +{fmtDollarExact(ap.breakeven.breakevenPrice - ap.avgSellingPrice)} needed
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Revenue waterfall total */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>P&L Line</th>
                    <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Total</th>
                    <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>Per Unit</th>
                    <th style={{ textAlign: "right", fontSize: 10, color: TEXT_DIM, paddingBottom: 6 }}>% of Rev</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Gross Revenue", total: ap.grossRevenue, perUnit: ap.avgSellingPrice, pct: 100 },
                    { label: "Promotions", total: -ap.promotions, perUnit: -(ap.promotions / Math.max(ap.totalUnits, 1)), pct: ap.netRevenue > 0 ? -(ap.promotions / ap.grossRevenue) * 100 : 0 },
                    { label: "Net Revenue", total: ap.netRevenue, perUnit: ap.netRevenue / Math.max(ap.totalUnits, 1), pct: ap.grossRevenue > 0 ? (ap.netRevenue / ap.grossRevenue) * 100 : 0, bold: true },
                    { label: "Referral Fees", total: -ap.totalReferralFees, perUnit: -ap.feesPerUnit.referral, pct: ap.netRevenue > 0 ? -(ap.totalReferralFees / ap.netRevenue) * 100 : 0 },
                    { label: "FBA Fees", total: -ap.totalFBAFees, perUnit: -ap.feesPerUnit.fba, pct: ap.netRevenue > 0 ? -(ap.totalFBAFees / ap.netRevenue) * 100 : 0 },
                    { label: "Gross Profit", total: ap.grossProfit, perUnit: ap.grossProfit / Math.max(ap.totalUnits, 1), pct: ap.grossMargin, bold: true },
                    { label: "COGS", total: -ap.totalCOGS, perUnit: -ap.cogsPerUnit, pct: ap.netRevenue > 0 ? -(ap.totalCOGS / ap.netRevenue) * 100 : 0 },
                    { label: "Inbound Shipping", total: -ap.totalInbound, perUnit: -ap.inboundPerUnit, pct: ap.netRevenue > 0 ? -(ap.totalInbound / ap.netRevenue) * 100 : 0 },
                    { label: "NET PROFIT", total: ap.netProfit, perUnit: ap.profitPerUnit, pct: ap.netMargin, bold: true },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, color: NAVY, fontWeight: row.bold ? 800 : 600 }}>
                        {row.label}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: row.total < 0 ? RED : NAVY, fontWeight: row.bold ? 800 : 600 }}>
                        {row.total < 0 ? "-" : ""}{fmtDollarExact(Math.abs(row.total))}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: row.perUnit < 0 ? RED : NAVY, fontWeight: row.bold ? 700 : 400 }}>
                        {row.perUnit < 0 ? "-" : ""}${Math.abs(row.perUnit).toFixed(2)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "6px 0", fontSize: 12, textAlign: "right", color: row.pct < 0 ? RED : TEXT_DIM }}>
                        {row.pct < 0 ? "" : ""}{row.pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 11, color: TEXT_DIM }}>
              Fees from Amazon SP-API fee estimates.
              COGS and inbound shipping are estimated from observed channel economics.
              {ap.feesSource === "fallback" && " ⚠ Fee estimate is using fallback rates (Fees API unavailable)."}
            </div>
          </>
        )}
      </div>

      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "14px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Live Financial Snapshot</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {[
            { label: "Net Margin", value: pnl?.netMargin != null ? `${pnl.netMargin.toFixed(1)}%` : "—" },
            { label: "Gross Margin", value: pnl?.grossMargin != null ? `${pnl.grossMargin.toFixed(1)}%` : "—" },
            { label: "Total Orders (Dashboard)", value: dashboard?.combined?.totalOrders != null ? String(dashboard.combined.totalOrders) : "—" },
            { label: "Amazon Orders (30d)", value: ap?.totalOrders != null ? String(ap.totalOrders) : "—" },
          ].map((item) => (
            <div key={item.label} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: BG, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 18, color: NAVY, fontWeight: 800 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1.7fr 1fr",
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
              <span style={{ color: NAVY, fontWeight: 700 }}>
                {forecast?.currentBalance != null ? fmtDollar(forecast.currentBalance) : <span style={{ color: TEXT_DIM }}>—</span>}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: TEXT_DIM }}>Runway</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>
                {forecast?.runway != null ? `${forecast.runway} days` : <span style={{ color: TEXT_DIM }}>—</span>}
              </span>
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

      <div style={{ marginTop: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: `1px solid ${BORDER}`,
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 11,
            color: TEXT_DIM,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            background: CARD,
          }}
        >
          Data sources: Shopify, Amazon
        </span>
      </div>
    </div>
  );
}
