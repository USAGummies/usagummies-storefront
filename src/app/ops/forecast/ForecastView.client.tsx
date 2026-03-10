"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Wallet, Flame, CalendarClock, AlertTriangle, Timer, Brain } from "lucide-react";
import { useForecastData, fmtDollar } from "@/lib/ops/use-war-room-data";
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

type Receivable = {
  source: string;
  amount: number;
  expectedDate: string;
  confidence: string;
  description: string;
};

type Payable = {
  category: string;
  amount: number;
  dueDate: string;
  recurring: boolean;
  description: string;
};

type ProjectionPoint = {
  date: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  receivables?: Receivable[];
  payables?: Payable[];
};

type RevenueForecastPoint = {
  date: string;
  predicted: number;
  lower_bound: number;
  upper_bound: number;
  channel: "shopify" | "amazon" | "total";
};

type RevenueForecastResult = {
  channel: "shopify" | "amazon" | "total";
  points: RevenueForecastPoint[];
  trend: "growing" | "flat" | "declining";
  growth_rate_pct: number;
  confidence: "high" | "medium" | "low";
  data_points_used: number;
};

function HeaderCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
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

export function ForecastView() {
  const { data: forecast, loading, error, refresh } = useForecastData();
  const [brain, setBrain] = useState<{ insights: string[]; sources: { title: string; source_table: string }[] } | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [revenueForecast, setRevenueForecast] = useState<RevenueForecastResult[]>([]);
  const [revenueActualRows, setRevenueActualRows] = useState<
    Array<{ date: string; shopify_actual: number; amazon_actual: number; total_actual: number }>
  >([]);
  const [revenueForecastLoading, setRevenueForecastLoading] = useState(true);
  const [revenueForecastError, setRevenueForecastError] = useState<string | null>(null);

  const fetchBrainInsights = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch("/api/ops/abra/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "cash flow forecast revenue expenses runway burn rate financial projections" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch insights");
      setBrain(data);
    } catch (err) {
      setBrainError(err instanceof Error ? err.message : "Brain query failed");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  const points = (forecast?.projections?.["90d"] || []) as unknown as ProjectionPoint[];
  const points30 = (forecast?.projections?.["30d"] || []) as unknown as ProjectionPoint[];

  useEffect(() => {
    let cancelled = false;

    async function loadRevenueForecast() {
      setRevenueForecastLoading(true);
      setRevenueForecastError(null);
      try {
        const [forecastRes, actualRes] = await Promise.all([
          fetch("/api/ops/abra/forecast?days=30&channel=all", { cache: "no-store" }),
          fetch(
            "/api/ops/abra/kpi-history?metrics=daily_revenue_shopify,daily_revenue_amazon&days=35",
            { cache: "no-store" },
          ),
        ]);

        if (!forecastRes.ok) {
          const data = (await forecastRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Failed to load revenue forecast");
        }
        if (!actualRes.ok) {
          const data = (await actualRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Failed to load revenue history");
        }

        const forecastData = (await forecastRes.json()) as { forecasts?: RevenueForecastResult[] };
        const actualData = (await actualRes.json()) as {
          metrics?: Record<string, Array<{ date: string; value: number }>>;
        };

        const forecastRows = Array.isArray(forecastData.forecasts) ? forecastData.forecasts : [];
        const shopify = actualData?.metrics?.daily_revenue_shopify || [];
        const amazon = actualData?.metrics?.daily_revenue_amazon || [];
        const byDate = new Map<string, { shopify_actual: number; amazon_actual: number; total_actual: number }>();

        for (const row of shopify) {
          byDate.set(row.date, {
            shopify_actual: Number(row.value || 0),
            amazon_actual: byDate.get(row.date)?.amazon_actual || 0,
            total_actual:
              Number(row.value || 0) + (byDate.get(row.date)?.amazon_actual || 0),
          });
        }
        for (const row of amazon) {
          const current = byDate.get(row.date) || {
            shopify_actual: 0,
            amazon_actual: 0,
            total_actual: 0,
          };
          byDate.set(row.date, {
            shopify_actual: current.shopify_actual,
            amazon_actual: Number(row.value || 0),
            total_actual: current.shopify_actual + Number(row.value || 0),
          });
        }

        if (!cancelled) {
          setRevenueForecast(forecastRows);
          setRevenueActualRows(
            [...byDate.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([date, values]) => ({ date, ...values })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setRevenueForecastError(
            err instanceof Error ? err.message : "Failed to load revenue forecast",
          );
        }
      } finally {
        if (!cancelled) {
          setRevenueForecastLoading(false);
        }
      }
    }

    void loadRevenueForecast();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthlyBurn = useMemo(() => {
    if (points30.length === 0) return 0;
    const totalOut = points30.reduce((sum, row) => sum + row.outflows, 0);
    const totalIn = points30.reduce((sum, row) => sum + row.inflows, 0);
    return totalOut - totalIn;
  }, [points30]);

  const receivables = useMemo(() => {
    return points
      .flatMap((row) => row.receivables || [])
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
      .slice(0, 20);
  }, [points]);

  const payables = useMemo(() => {
    return points
      .flatMap((row) => row.payables || [])
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 20);
  }, [points]);

  const nextSettlementDate = useMemo(() => {
    const settlements = receivables
      .filter((r) => r.source === "amazon_settlement" || r.source === "shopify_payout")
      .map((r) => r.expectedDate)
      .sort((a, b) => a.localeCompare(b));
    return settlements[0] || null;
  }, [receivables]);

  const chartRows = points.map((row) => {
    const optimistic = row.closingBalance + row.inflows * 0.15;
    const pessimistic = row.closingBalance - row.outflows * 0.15;
    return {
      date: row.date.slice(5),
      base: row.closingBalance,
      optimistic,
      pessimistic,
    };
  });

  const forecastByChannel = useMemo(() => {
    const map = new Map<string, RevenueForecastResult>();
    for (const item of revenueForecast) {
      map.set(item.channel, item);
    }
    return map;
  }, [revenueForecast]);

  const totalForecast = forecastByChannel.get("total") || null;
  const annualizedGrowth = totalForecast?.growth_rate_pct || 0;
  const growthArrow = annualizedGrowth > 0 ? "▲" : annualizedGrowth < 0 ? "▼" : "•";
  const projected30dRevenue = useMemo(() => {
    if (!totalForecast) return 0;
    return totalForecast.points.reduce((sum, point) => sum + Number(point.predicted || 0), 0);
  }, [totalForecast]);
  const projectedSpread = useMemo(() => {
    if (!totalForecast || totalForecast.points.length === 0) return 0;
    const avgBand =
      totalForecast.points.reduce(
        (sum, point) => sum + (Number(point.upper_bound || 0) - Number(point.lower_bound || 0)),
        0,
      ) / totalForecast.points.length;
    return avgBand / 2;
  }, [totalForecast]);

  const revenueForecastChartRows = useMemo(() => {
    const shopifyPoints = forecastByChannel.get("shopify")?.points || [];
    const amazonPoints = forecastByChannel.get("amazon")?.points || [];
    const totalPoints = forecastByChannel.get("total")?.points || [];

    const byDate = new Map<
      string,
      {
        date: string;
        label: string;
        shopify_predicted: number | null;
        amazon_predicted: number | null;
        total_predicted: number | null;
        shopify_actual: number | null;
        amazon_actual: number | null;
        total_actual: number | null;
        upper_bound: number | null;
        lower_bound: number | null;
      }
    >();

    function ensure(date: string) {
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          label: date.slice(5),
          shopify_predicted: null,
          amazon_predicted: null,
          total_predicted: null,
          shopify_actual: null,
          amazon_actual: null,
          total_actual: null,
          upper_bound: null,
          lower_bound: null,
        });
      }
      return byDate.get(date)!;
    }

    for (const row of shopifyPoints) {
      const item = ensure(row.date);
      item.shopify_predicted = row.predicted;
    }
    for (const row of amazonPoints) {
      const item = ensure(row.date);
      item.amazon_predicted = row.predicted;
    }
    for (const row of totalPoints) {
      const item = ensure(row.date);
      item.total_predicted = row.predicted;
      item.upper_bound = row.upper_bound;
      item.lower_bound = row.lower_bound;
    }
    for (const row of revenueActualRows) {
      const item = ensure(row.date);
      item.shopify_actual = row.shopify_actual;
      item.amazon_actual = row.amazon_actual;
      item.total_actual = row.total_actual;
    }

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [forecastByChannel, revenueActualRows]);

  const freshnessItems = [{ label: "Forecast", timestamp: forecast?.generatedAt }];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Cash Forecast</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            90-day cash projection with receivables, payables, and runway risk alerts.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => void fetchBrainInsights()}
            disabled={brainLoading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: `1px solid ${brain ? `${GOLD}60` : BORDER}`,
              borderRadius: 10, background: brain ? `${GOLD}0d` : CARD,
              color: NAVY, padding: "8px 12px", fontSize: 12, fontWeight: 700,
              cursor: brainLoading ? "default" : "pointer",
              opacity: brainLoading ? 0.7 : 1,
            }}
          >
            <Brain size={14} />
            {brainLoading ? "Thinking..." : brain ? "Refresh Intel" : "🧠 Intel"}
          </button>
          <RefreshButton loading={loading} onClick={() => refresh()} />
        </div>
      </div>

      {brainError && (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}0a`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: RED }}>
          🧠 Brain: {brainError}
        </div>
      )}
      {brain && brain.insights.length > 0 && (
        <div style={{ background: `${GOLD}0d`, border: `1px solid ${GOLD}30`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 14 }}>
            <Brain size={16} /> Financial Intelligence
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {brain.insights.map((insight, i) => (
              <li key={i} style={{ fontSize: 13, color: NAVY, lineHeight: 1.6, marginBottom: 4 }}>{insight}</li>
            ))}
          </ul>
          {brain.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {brain.sources.map((s, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: s.source_table === "email" ? `${NAVY}10` : `${GOLD}18`,
                  border: `1px solid ${s.source_table === "email" ? `${NAVY}20` : `${GOLD}30`}`,
                  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: NAVY, fontWeight: 600,
                }}>
                  {s.source_table === "email" ? "📧" : "🧠"} {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {error ? (
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
          {error}
        </div>
      ) : null}

      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "14px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>
          Revenue Forecast
        </div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 10 }}>
          30-day projection with confidence interval and channel breakouts.
        </div>
        {revenueForecastError ? (
          <div
            style={{
              border: `1px solid ${RED}33`,
              background: `${RED}0a`,
              borderRadius: 10,
              padding: "9px 12px",
              marginBottom: 10,
              color: RED,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {revenueForecastError}
          </div>
        ) : null}
        {revenueForecastLoading && revenueForecastChartRows.length === 0 ? (
          <SkeletonChart height={300} />
        ) : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <ComposedChart data={revenueForecastChartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip
                  formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="upper_bound"
                  stroke="none"
                  fill={GOLD}
                  fillOpacity={0.16}
                  name="80% CI Upper"
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="lower_bound"
                  stroke="none"
                  fill={CARD}
                  fillOpacity={1}
                  name="80% CI Lower"
                  legendType="none"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="shopify_predicted"
                  stroke={NAVY}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="6 4"
                  name="Shopify (Predicted)"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="amazon_predicted"
                  stroke={RED}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="6 4"
                  name="Amazon (Predicted)"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="total_predicted"
                  stroke={GOLD}
                  strokeWidth={2.1}
                  dot={false}
                  strokeDasharray="6 4"
                  name="Total (Predicted)"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="shopify_actual"
                  stroke={NAVY}
                  strokeWidth={2}
                  dot={false}
                  name="Shopify (Actual)"
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="amazon_actual"
                  stroke={RED}
                  strokeWidth={2}
                  dot={false}
                  name="Amazon (Actual)"
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          <div
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase" }}>
              30-Day Projected Revenue
            </div>
            <div style={{ color: NAVY, fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {fmtDollar(projected30dRevenue)}
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>
              ± {fmtDollar(projectedSpread)} average confidence spread/day
            </div>
          </div>
          <div
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase" }}>
              Annualized Growth Rate
            </div>
            <div style={{ color: NAVY, fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {growthArrow} {Math.abs(annualizedGrowth).toFixed(1)}%
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>
              Trend: {totalForecast?.trend || "flat"}
            </div>
          </div>
          <div
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase" }}>
              Confidence Level
            </div>
            <div style={{ color: NAVY, fontSize: 24, fontWeight: 800, marginTop: 4, textTransform: "capitalize" }}>
              {totalForecast?.confidence || "low"}
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>
              Data points: {totalForecast?.data_points_used || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Awaiting data banner — Plaid not connected */}
      {!loading && !forecast?.currentBalance && points.length === 0 ? (
        <div
          style={{
            border: `1px solid ${GOLD}55`,
            background: `${GOLD}12`,
            color: NAVY,
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <strong>Awaiting Data — Plaid API pending.</strong> Cash forecast requires bank account
          connectivity via Plaid. Current balance, runway, burn rate, receivables, and payables will
          populate once Plaid is integrated. All figures below will show $0 until then.
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
          icon={<Wallet size={16} />}
          label="Current Cash"
          value={fmtDollar(forecast?.currentBalance || 0)}
        />
        <HeaderCard
          icon={<Timer size={16} />}
          label="Runway"
          value={`${forecast?.runway || 0} days`}
          hint="Projected days until cash floor"
        />
        <HeaderCard
          icon={<Flame size={16} />}
          label="Monthly Burn"
          value={fmtDollar(monthlyBurn)}
          hint="30-day net outflow projection"
        />
        <HeaderCard
          icon={<CalendarClock size={16} />}
          label="Next Settlement"
          value={nextSettlementDate ? new Date(nextSettlementDate).toLocaleDateString("en-US") : "N/A"}
        />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>90-Day Cash Projection</div>
        {loading && chartRows.length === 0 ? (
          <SkeletonChart height={280} />
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={chartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))} />
                <Line type="monotone" dataKey="base" stroke={NAVY} strokeWidth={2.2} dot={false} name="Base" />
                <Line type="monotone" dataKey="optimistic" stroke="#16a34a" strokeWidth={1.8} dot={false} strokeDasharray="5 3" name="Optimistic" />
                <Line type="monotone" dataKey="pessimistic" stroke={RED} strokeWidth={1.8} dot={false} strokeDasharray="5 3" name="Pessimistic" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Receivables</div>
          {loading && receivables.length === 0 ? (
            <SkeletonTable rows={6} />
          ) : receivables.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No receivables in forecast horizon.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Source</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Amount</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Date</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((row, idx) => (
                    <tr key={`${row.source}-${row.expectedDate}-${idx}`}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: NAVY, fontSize: 13, fontWeight: 700 }}>
                        {row.source.replace(/_/g, " ")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", textAlign: "right", color: NAVY, fontWeight: 700 }}>
                        {fmtDollar(row.amount)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {new Date(row.expectedDate).toLocaleDateString("en-US")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {row.confidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Payables</div>
          {loading && payables.length === 0 ? (
            <SkeletonTable rows={6} />
          ) : payables.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No payables in forecast horizon.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Category</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Amount</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Due Date</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Recurring</th>
                  </tr>
                </thead>
                <tbody>
                  {payables.map((row, idx) => (
                    <tr key={`${row.category}-${row.dueDate}-${idx}`}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: NAVY, fontSize: 13, fontWeight: 700 }}>
                        {row.category}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", textAlign: "right", color: NAVY, fontWeight: 700 }}>
                        {fmtDollar(row.amount)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {new Date(row.dueDate).toLocaleDateString("en-US")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {row.recurring ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Forecast Alerts</div>
        {(forecast?.alerts || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            {loading ? "Loading forecast alerts..." : "No forecast alerts right now."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(forecast?.alerts || []).map((alert, idx) => (
              <div key={`${idx}-${alert}`} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", gap: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    marginTop: 5,
                    background: /runway|negative|below/i.test(alert) ? RED : GOLD,
                  }}
                />
                <div style={{ color: NAVY, fontSize: 13, fontWeight: 600 }}>{alert}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
