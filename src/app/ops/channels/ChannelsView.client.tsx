"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { useIsMobile } from "@/app/ops/hooks";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type ChannelMetrics = {
  channel: string;
  revenue_30d: number;
  orders_30d: number;
  aov: number;
  customers_30d: number;
  repeat_rate_pct: number;
  estimated_cac: number;
  ltv_estimate: number;
  margin_pct: number;
  roas: number;
};

type AttributionReport = {
  channels: ChannelMetrics[];
  total_revenue_30d: number;
  total_orders_30d: number;
  blended_cac: number;
  blended_aov: number;
  period: { start: string; end: string };
};

type KpiHistoryResponse = {
  metrics?: Record<string, Array<{ date: string; value: number }>>;
};

const COLORS: Record<string, string> = {
  shopify_dtc: NAVY,
  amazon_fba: RED,
  faire: GOLD,
  wholesale: "#51607c",
  other: "#6b7280",
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function ChannelsView() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [kpiHistory, setKpiHistory] = useState<KpiHistoryResponse | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [attrRes, historyRes] = await Promise.all([
        fetch("/api/ops/abra/attribution", { cache: "no-store" }),
        fetch(
          "/api/ops/abra/kpi-history?metrics=daily_revenue_shopify,daily_revenue_amazon&days=30",
          { cache: "no-store" },
        ),
      ]);
      if (!attrRes.ok) {
        const payload = (await attrRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to fetch attribution report");
      }
      if (!historyRes.ok) {
        const payload = (await historyRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to fetch KPI history");
      }

      const attrData = (await attrRes.json()) as AttributionReport;
      const historyData = (await historyRes.json()) as KpiHistoryResponse;
      setReport(attrData);
      setKpiHistory(historyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel metrics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const freshnessItems = [
    {
      label: "Attribution",
      timestamp: new Date().toISOString(),
    },
  ];

  const pieRows = useMemo(() => {
    const channels = report?.channels || [];
    return channels.map((channel) => ({
      name: channel.channel,
      value: channel.revenue_30d,
      color: COLORS[channel.channel] || COLORS.other,
    }));
  }, [report?.channels]);

  const trendRows = useMemo(() => {
    const shopify = kpiHistory?.metrics?.daily_revenue_shopify || [];
    const amazon = kpiHistory?.metrics?.daily_revenue_amazon || [];
    const faire = report?.channels.find((row) => row.channel === "faire");
    const wholesale = report?.channels.find((row) => row.channel === "wholesale");
    const faireDaily = (faire?.revenue_30d || 0) / 30;
    const wholesaleDaily = (wholesale?.revenue_30d || 0) / 30;

    const byDate = new Map<
      string,
      { date: string; label: string; shopify: number; amazon: number; faire: number; wholesale: number }
    >();

    function ensure(date: string) {
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          label: date.slice(5),
          shopify: 0,
          amazon: 0,
          faire: round2(faireDaily),
          wholesale: round2(wholesaleDaily),
        });
      }
      return byDate.get(date)!;
    }

    for (const row of shopify) {
      const item = ensure(row.date);
      item.shopify = row.value;
    }
    for (const row of amazon) {
      const item = ensure(row.date);
      item.amazon = row.value;
    }

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [kpiHistory?.metrics, report?.channels]);

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: NAVY, fontSize: 30, letterSpacing: "-0.02em" }}>
            Revenue by Channel
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            30-day attribution across DTC, Amazon, Faire, and wholesale.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${RED}33`,
            background: `${RED}0f`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr",
          marginBottom: 12,
        }}
      >
        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "16px 18px",
          }}
        >
          <div style={{ color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 10 }}>
            Channel Comparison (30d)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={headCell}>Channel</th>
                  <th style={headCellRight}>Revenue</th>
                  <th style={headCellRight}>Orders</th>
                  <th style={headCellRight}>AOV</th>
                  <th style={headCellRight}>Margin</th>
                  <th style={headCellRight}>Est. CAC</th>
                  <th style={headCellRight}>Est. ROAS</th>
                </tr>
              </thead>
              <tbody>
                {(report?.channels || []).map((channel) => (
                  <tr key={channel.channel}>
                    <td style={bodyCell}>{channel.channel}</td>
                    <td style={bodyCellRight}>{formatUsd(channel.revenue_30d)}</td>
                    <td style={bodyCellRight}>{channel.orders_30d.toLocaleString("en-US")}</td>
                    <td style={bodyCellRight}>{formatUsd(channel.aov)}</td>
                    <td style={bodyCellRight}>{channel.margin_pct.toFixed(1)}%</td>
                    <td style={bodyCellRight}>{formatUsd(channel.estimated_cac)}</td>
                    <td style={bodyCellRight}>{channel.roas.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "16px 18px",
          }}
        >
          <div style={{ color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 10 }}>
            Revenue Split
          </div>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieRows} dataKey="value" nameKey="name" outerRadius={isMobile ? 90 : 110}>
                  {pieRows.map((row) => (
                    <Cell key={row.name} fill={row.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number | string | undefined) => formatUsd(Number(value || 0))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "16px 18px",
        }}
      >
        <div style={{ color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 10 }}>
          Trend Comparison (30d Revenue)
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={trendRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
              <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
              <Tooltip formatter={(value: number | string | undefined) => formatUsd(Number(value || 0))} />
              <Legend />
              <Line dataKey="shopify" stroke={NAVY} strokeWidth={2} dot={false} name="Shopify DTC" />
              <Line dataKey="amazon" stroke={RED} strokeWidth={2} dot={false} name="Amazon FBA" />
              <Line dataKey="faire" stroke={GOLD} strokeWidth={1.8} dot={false} strokeDasharray="6 4" name="Faire (Avg)" />
              <Line dataKey="wholesale" stroke="#51607c" strokeWidth={1.8} dot={false} strokeDasharray="6 4" name="Wholesale (Avg)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const headCell: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  color: TEXT_DIM,
  padding: "0 12px 8px 0",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const headCellRight: React.CSSProperties = {
  ...headCell,
  textAlign: "right",
};

const bodyCell: React.CSSProperties = {
  borderTop: `1px solid ${BORDER}`,
  padding: "8px 12px 8px 0",
  fontSize: 13,
  color: NAVY,
  fontWeight: 600,
};

const bodyCellRight: React.CSSProperties = {
  ...bodyCell,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
