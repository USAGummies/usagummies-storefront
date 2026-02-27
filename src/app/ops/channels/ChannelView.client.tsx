"use client";

import {
  MONTHS,
  MONTH_LABELS,
  AMAZON,
  WHOLESALE,
  DISTRIBUTOR,
  TOTAL_REVENUE,
  UNIT_ECONOMICS,
  DISTRIBUTOR_NETWORK,
  type Month,
  type ChannelMetrics,
} from "@/lib/ops/pro-forma";

import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

import {
  ShoppingCart,
  Store,
  Truck,
  TrendingUp,
  DollarSign,
  BarChart3,
  Users,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const BG = "#f8f5ef";
const CARD_BG = "#ffffff";
const BORDER = "rgba(27,42,74,0.08)";
const TEXT_DIM = "rgba(27,42,74,0.5)";
const TEXT_MED = "rgba(27,42,74,0.72)";

const CHANNEL_COLORS = {
  amazon: GOLD,
  wholesale: NAVY,
  distributor: RED,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sumChannel(ch: ChannelMetrics, key: "units" | "revenue" | "grossProfit"): number {
  return MONTHS.reduce((s, m) => s + ch[key][m], 0);
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

function fmtUnits(n: number): string {
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Data prep
// ---------------------------------------------------------------------------
const totalRevAll = MONTHS.reduce((s, m) => s + TOTAL_REVENUE[m], 0);

const channels = [
  {
    key: "amazon" as const,
    label: "Amazon",
    icon: ShoppingCart,
    color: GOLD,
    data: AMAZON,
    gpPerUnit: UNIT_ECONOMICS.amazon.gpPerUnit,
    pricing: {
      cogs: UNIT_ECONOMICS.cogsPerBag + UNIT_ECONOMICS.amazon.fbaFees,
      wholesale: UNIT_ECONOMICS.amazon.retailPrice,
      retail: UNIT_ECONOMICS.amazon.retailPrice,
      cogsLabel: "COGS + FBA",
      wholesaleLabel: "Retail",
    },
    note: null as string | null,
  },
  {
    key: "wholesale" as const,
    label: "Wholesale / Faire",
    icon: Store,
    color: NAVY,
    data: WHOLESALE,
    gpPerUnit: UNIT_ECONOMICS.wholesale.gpPerUnit,
    pricing: {
      cogs: UNIT_ECONOMICS.cogsPerBag,
      wholesale: UNIT_ECONOMICS.wholesale.price,
      retail: null as number | null,
      cogsLabel: "COGS",
      wholesaleLabel: "Wholesale",
    },
    note: "Includes Faire marketplace orders",
  },
  {
    key: "distributor" as const,
    label: "Distributor Network",
    icon: Truck,
    color: RED,
    data: DISTRIBUTOR,
    gpPerUnit: UNIT_ECONOMICS.distributor.gpPerUnit,
    pricing: {
      cogs: UNIT_ECONOMICS.cogsPerBag + UNIT_ECONOMICS.distributor.displayCostPerUnit,
      wholesale: UNIT_ECONOMICS.distributor.sellPrice,
      retail: null as number | null,
      cogsLabel: "COGS + Display",
      wholesaleLabel: "Sell Price",
    },
    note: null,
  },
];

// Monthly chart data
const monthlyChartData = MONTHS.map((m) => ({
  month: MONTH_LABELS[m],
  Amazon: AMAZON.revenue[m],
  Wholesale: WHOLESALE.revenue[m],
  Distributor: DISTRIBUTOR.revenue[m],
  total: AMAZON.revenue[m] + WHOLESALE.revenue[m] + DISTRIBUTOR.revenue[m],
}));

const monthlyUnitsData = MONTHS.map((m) => ({
  month: MONTH_LABELS[m],
  Amazon: AMAZON.units[m],
  Wholesale: WHOLESALE.units[m],
  Distributor: DISTRIBUTOR.units[m],
}));

// Distributor network table data
type DistributorTableRow = {
  month: string;
  monthKey: Month;
  newDistributors: number;
  cumulative: number;
  unitsPerDistributor: number;
  totalUnits: number;
  highlight: boolean;
};

const distTableData: DistributorTableRow[] = MONTHS.map((m) => {
  const newThisMonth = DISTRIBUTOR_NETWORK.filter((d) => d.startMonth === m).length;
  const cumulative = DISTRIBUTOR_NETWORK.filter(
    (d) => typeof d.startMonth === "string" && MONTHS.includes(d.startMonth as Month) && MONTHS.indexOf(d.startMonth as Month) <= MONTHS.indexOf(m)
  ).length;
  const totalUnits = DISTRIBUTOR.units[m];
  const unitsPerDist = cumulative > 0 ? Math.round(totalUnits / cumulative) : 0;

  return {
    month: MONTH_LABELS[m],
    monthKey: m,
    newDistributors: newThisMonth,
    cumulative,
    unitsPerDistributor: unitsPerDist,
    totalUnits,
    highlight: newThisMonth > 0,
  };
});

// Margin comparison data
const marginData = channels.map((ch) => ({
  channel: ch.label,
  gpPerUnit: ch.gpPerUnit,
  cogs: ch.pricing.cogs,
  sellPrice: ch.pricing.wholesale,
  color: ch.color,
}));

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 16px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 700, color: NAVY, marginBottom: 8 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 4, fontSize: 13 }}>
          <span style={{ color: p.color, fontWeight: 600 }}>{p.name}</span>
          <span style={{ color: NAVY, fontWeight: 500 }}>{fmt(p.value)}</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 700, color: NAVY, fontSize: 13 }}>
        <span>Total</span>
        <span>{fmt(total)}</span>
      </div>
    </div>
  );
}

function UnitsTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 16px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 700, color: NAVY, marginBottom: 8 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 4, fontSize: 13 }}>
          <span style={{ color: p.color, fontWeight: 600 }}>{p.name}</span>
          <span style={{ color: NAVY, fontWeight: 500 }}>{fmtUnits(p.value)} units</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 700, color: NAVY, fontSize: 13 }}>
        <span>Total</span>
        <span>{fmtUnits(total)} units</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon size={20} color={NAVY} strokeWidth={1.8} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em" }}>{title}</h2>
      </div>
      {subtitle && <p style={{ margin: "4px 0 0 30px", fontSize: 13, color: TEXT_DIM }}>{subtitle}</p>}
    </div>
  );
}

function ChannelScorecard({ ch }: { ch: (typeof channels)[0] }) {
  const Icon = ch.icon;
  const annualUnits = sumChannel(ch.data, "units");
  const annualRevenue = sumChannel(ch.data, "revenue");
  const annualGP = sumChannel(ch.data, "grossProfit");
  const channelShare = annualRevenue / totalRevAll;

  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 280,
        background: CARD_BG,
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      {/* Color bar */}
      <div style={{ height: 4, background: ch.color }} />

      <div style={{ padding: "20px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: ch.color + "14",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={18} color={ch.color} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: NAVY }}>{ch.label}</div>
            {ch.note && <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 1 }}>{ch.note}</div>}
          </div>
          <div
            style={{
              marginLeft: "auto",
              background: ch.color + "18",
              color: ch.color,
              fontWeight: 700,
              fontSize: 13,
              padding: "4px 10px",
              borderRadius: 6,
            }}
          >
            {pct(channelShare)} share
          </div>
        </div>

        {/* Metrics grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <MetricBox label="Annual Units" value={annualUnits.toLocaleString()} />
          <MetricBox label="Annual Revenue" value={fmt(annualRevenue)} />
          <MetricBox label="Gross Profit" value={fmt(annualGP)} />
          <MetricBox label="GP / Unit" value={"$" + ch.gpPerUnit.toFixed(2)} highlight={ch.gpPerUnit > 1} />
        </div>

        {/* Pricing strip */}
        <div
          style={{
            background: "#f4f2ed",
            borderRadius: 8,
            padding: "10px 14px",
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <PricePill label={ch.pricing.cogsLabel} value={"$" + ch.pricing.cogs.toFixed(2)} />
          <PricePill label={ch.pricing.wholesaleLabel} value={"$" + ch.pricing.wholesale.toFixed(2)} />
          {ch.pricing.retail && <PricePill label="Retail" value={"$" + ch.pricing.retail.toFixed(2)} />}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: highlight ? "#2d8a4e" : NAVY }}>{value}</div>
    </div>
  );
}

function PricePill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, color: TEXT_DIM, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function ChannelView() {
  return (
    <div style={{ padding: "32px 28px 60px", maxWidth: 1200, margin: "0 auto" }}>
      {/* HEADER */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: NAVY, letterSpacing: "-0.02em" }}>Channel Intelligence</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: TEXT_MED }}>Multi-Channel Revenue &amp; Distribution Analysis</p>
      </div>

      {/* CHANNEL SCORECARDS */}
      <div style={{ display: "flex", gap: 20, marginBottom: 40, flexWrap: "wrap" }}>
        {channels.map((ch) => (
          <ChannelScorecard key={ch.key} ch={ch} />
        ))}
      </div>

      {/* MONTHLY REVENUE BY CHANNEL */}
      <div
        style={{
          background: CARD_BG,
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          padding: "24px 24px 16px",
          marginBottom: 32,
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <SectionHeading icon={DollarSign} title="Monthly Revenue by Channel" subtitle="Stacked monthly view across all three sales channels" />
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <BarChart data={monthlyChartData} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: NAVY, fontSize: 12 }} tickLine={false} axisLine={{ stroke: BORDER }} />
              <YAxis
                tick={{ fill: TEXT_DIM, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`)}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="square"
                wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              />
              <Bar dataKey="Amazon" stackId="rev" fill={GOLD} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Wholesale" stackId="rev" fill={NAVY} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Distributor" stackId="rev" fill={RED} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* MONTHLY UNITS BY CHANNEL */}
      <div
        style={{
          background: CARD_BG,
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          padding: "24px 24px 16px",
          marginBottom: 32,
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <SectionHeading icon={Package} title="Monthly Units by Channel" subtitle="Unit volume ramp showing growth trajectory by channel" />
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <AreaChart data={monthlyUnitsData}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: NAVY, fontSize: 12 }} tickLine={false} axisLine={{ stroke: BORDER }} />
              <YAxis
                tick={{ fill: TEXT_DIM, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`)}
              />
              <Tooltip content={<UnitsTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="square"
                wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              />
              <Area
                type="monotone"
                dataKey="Distributor"
                stackId="units"
                stroke={RED}
                fill={RED + "30"}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Wholesale"
                stackId="units"
                stroke={NAVY}
                fill={NAVY + "25"}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Amazon"
                stackId="units"
                stroke={GOLD}
                fill={GOLD + "30"}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DISTRIBUTOR NETWORK PLAN */}
      <div
        style={{
          background: CARD_BG,
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          padding: "24px 24px 20px",
          marginBottom: 32,
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <SectionHeading icon={Users} title="Distributor Network Plan" subtitle="Ramp schedule from confirmed first distributor through planned expansion" />

        {/* Distributor roster */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {DISTRIBUTOR_NETWORK.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: d.status === "confirmed" ? RED + "10" : "#f4f2ed",
                border: `1px solid ${d.status === "confirmed" ? RED + "30" : BORDER}`,
                borderRadius: 8,
                padding: "8px 14px",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: d.status === "confirmed" ? "#2d8a4e" : d.status === "prospecting" ? GOLD : TEXT_DIM,
                }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{d.name}</div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}>
                  {typeof d.startMonth === "string" && MONTHS.includes(d.startMonth as Month)
                    ? MONTH_LABELS[d.startMonth as Month]
                    : d.startMonth}{" "}
                  &middot; {d.status}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                {["Month", "New Distributors", "Cumulative", "Units / Distributor", "Total Units"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Month" ? "left" : "right",
                      padding: "10px 14px",
                      borderBottom: `2px solid ${NAVY}`,
                      color: NAVY,
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {distTableData.map((row) => (
                <tr
                  key={row.monthKey}
                  style={{
                    background: row.highlight ? RED + "08" : "transparent",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 14px",
                      borderBottom: `1px solid ${BORDER}`,
                      fontWeight: row.highlight ? 700 : 500,
                      color: NAVY,
                    }}
                  >
                    {row.month}
                    {row.highlight && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          background: RED + "18",
                          color: RED,
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        NEW
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", color: row.newDistributors > 0 ? RED : TEXT_DIM, fontWeight: row.newDistributors > 0 ? 700 : 400 }}>
                    {row.newDistributors > 0 ? `+${row.newDistributors}` : "--"}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", color: NAVY, fontWeight: 600 }}>
                    {row.cumulative || "--"}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", color: TEXT_MED }}>
                    {row.unitsPerDistributor > 0 ? row.unitsPerDistributor.toLocaleString() : "--"}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", color: NAVY, fontWeight: 600 }}>
                    {row.totalUnits > 0 ? row.totalUnits.toLocaleString() : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MARGIN COMPARISON */}
      <div
        style={{
          background: CARD_BG,
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          padding: "24px 24px 20px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <SectionHeading icon={TrendingUp} title="Margin Comparison" subtitle="Gross profit per unit across channels -- Wholesale leads on margin, Amazon on volume" />

        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {/* Horizontal bar chart */}
          <div style={{ flex: "1 1 420px", minWidth: 320 }}>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={marginData} layout="vertical" barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: TEXT_DIM, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                    domain={[0, 2]}
                  />
                  <YAxis
                    type="category"
                    dataKey="channel"
                    tick={{ fill: NAVY, fontSize: 12, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                    width={140}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "GP / Unit"]}
                    contentStyle={{
                      background: CARD_BG,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  />
                  <Bar dataKey="gpPerUnit" radius={[0, 4, 4, 0]}>
                    {marginData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown cards */}
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
            {marginData.map((ch) => {
              const margin = ((ch.sellPrice - ch.cogs) / ch.sellPrice * 100);
              return (
                <div
                  key={ch.channel}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 18px",
                    background: "#f9f7f3",
                    borderRadius: 10,
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 40,
                      borderRadius: 3,
                      background: ch.color,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 2 }}>{ch.channel}</div>
                    <div style={{ fontSize: 11, color: TEXT_DIM }}>
                      Sell ${ch.sellPrice.toFixed(2)} &minus; COGS ${ch.cogs.toFixed(2)} = GP ${ch.gpPerUnit.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: ch.gpPerUnit > 1 ? "#2d8a4e" : NAVY }}>
                      ${ch.gpPerUnit.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_DIM }}>{margin.toFixed(0)}% margin</div>
                  </div>
                </div>
              );
            })}

            {/* Key insight */}
            <div
              style={{
                marginTop: 4,
                padding: "12px 16px",
                background: NAVY + "08",
                borderRadius: 8,
                border: `1px solid ${NAVY}18`,
                fontSize: 12,
                color: NAVY,
                lineHeight: 1.5,
              }}
            >
              <strong>Key Insight:</strong> Wholesale delivers <strong>$1.74 GP/unit</strong> (highest margin), Amazon drives unit velocity at scale, and Distributors provide the lowest per-unit margin but the highest total volume at maturity.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
