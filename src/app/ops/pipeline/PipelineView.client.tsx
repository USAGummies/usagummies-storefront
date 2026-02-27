"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Cell,
} from "recharts";
import {
  MapPin,
  Users,
  Truck,
  ShoppingBag,
  Store,
  Target,
  Calendar,
  CheckCircle2,
  BarChart3,
  Globe,
} from "lucide-react";
import {
  MONTHS,
  MONTH_LABELS,
  MONTH_FULL_LABELS,
  DISTRIBUTOR_NETWORK,
  DISTRIBUTOR,
  AMAZON,
  WHOLESALE,
  ANNUAL_SUMMARY,
  MILESTONES,
  UNIT_ECONOMICS,
  type Month,
} from "@/lib/ops/pro-forma";

// ---------------------------------------------------------------------------
// Design Tokens
// ---------------------------------------------------------------------------

const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const CREAM = "#f8f5ef";
const WHITE = "#ffffff";
const LIGHT_NAVY = "rgba(27, 42, 74, 0.06)";
const BORDER = "rgba(27, 42, 74, 0.12)";
const MUTED = "rgba(27, 42, 74, 0.55)";

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `$${n.toLocaleString()}`;
const fmtUnits = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : n.toLocaleString();
const fmtDollar = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// ---------------------------------------------------------------------------
// Data Computation
// ---------------------------------------------------------------------------

type NetworkRow = {
  month: string;
  monthKey: Month;
  newDistributors: number;
  cumulativeDistributors: number;
  unitsPerDistributor: number;
  totalDistributorUnits: number;
  distributorRevenue: number;
};

function buildNetworkData(): NetworkRow[] {
  const wholesalePrice = UNIT_ECONOMICS.distributor.sellPrice; // $2.50
  let cumulative = 0;
  return MONTHS.map((m) => {
    const newDist = DISTRIBUTOR_NETWORK.filter((d) => d.startMonth === m).length;
    cumulative += newDist;
    const units = DISTRIBUTOR.units[m];
    const perDist = cumulative > 0 ? Math.round(units / cumulative) : 0;
    return {
      month: MONTH_LABELS[m],
      monthKey: m,
      newDistributors: newDist,
      cumulativeDistributors: cumulative,
      unitsPerDistributor: perDist,
      totalDistributorUnits: units,
      distributorRevenue: units * wholesalePrice,
    };
  });
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>;

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: IconComponent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, marginTop: 40 }}>
      {Icon && <Icon size={20} color={RED} />}
      <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: "-0.01em" }}>
        {children}
      </h2>
    </div>
  );
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      style={{
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "18px 22px",
        flex: "1 1 180px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, marginBottom: 6, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent || NAVY, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function FunnelBar({ label, value, maxValue, color, sub }: { label: string; value: number; maxValue: number; color: string; sub?: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ background: LIGHT_NAVY, borderRadius: 6, height: 28, overflow: "hidden", position: "relative" as const }}>
        <div
          style={{
            background: color,
            height: "100%",
            width: `${Math.max(pct, 3)}%`,
            borderRadius: 6,
            transition: "width 0.5s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 8,
          }}
        >
          {pct > 20 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: WHITE }}>{Math.round(pct)}%</span>
          )}
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TerritoryCard({
  title,
  icon: Icon,
  description,
  annualUnits,
  annualRevenue,
  status,
  statusColor,
  metrics,
}: {
  title: string;
  icon: IconComponent;
  description: string;
  annualUnits: number;
  annualRevenue: number;
  status: string;
  statusColor: string;
  metrics: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 0,
        flex: "1 1 280px",
        minWidth: 260,
        overflow: "hidden",
      }}
    >
      <div style={{ background: NAVY, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <Icon size={22} color={GOLD} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: WHITE }}>{title}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{description}</div>
        </div>
      </div>
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600 }}>Annual Units</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{fmtUnits(annualUnits)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600 }}>Annual Revenue</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{fmtDollar(annualRevenue)}</div>
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: `${statusColor}15`,
            color: statusColor,
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: 20,
            marginBottom: 14,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          {status}
        </div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: MUTED }}>{m.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Recharts Tooltip
// ---------------------------------------------------------------------------

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div style={{ background: NAVY, borderRadius: 8, padding: "10px 14px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: WHITE, marginBottom: 6 }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginBottom: 2 }}>
          <span style={{ color: entry.color, fontWeight: 600 }}>{entry.name}:</span>{" "}
          {entry.name.toLowerCase().includes("revenue") || entry.name.toLowerCase().includes("$")
            ? fmtDollar(entry.value)
            : fmtUnits(entry.value)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PipelineView() {
  const networkData = useMemo(() => buildNetworkData(), []);

  // Channel annual totals
  const amazonUnits = Object.values(AMAZON.units).reduce((a, b) => a + b, 0);
  const amazonRevenue = Object.values(AMAZON.revenue).reduce((a, b) => a + b, 0);
  const wholesaleUnits = Object.values(WHOLESALE.units).reduce((a, b) => a + b, 0);
  const wholesaleRevenue = Object.values(WHOLESALE.revenue).reduce((a, b) => a + b, 0);
  const distributorUnits = Object.values(DISTRIBUTOR.units).reduce((a, b) => a + b, 0);
  const distributorRevenue = Object.values(DISTRIBUTOR.revenue).reduce((a, b) => a + b, 0);
  const totalDistributors = DISTRIBUTOR_NETWORK.length;

  // Funnel data
  const totalNewNeeded = totalDistributors;
  const confirmed = DISTRIBUTOR_NETWORK.filter((d) => d.status === "confirmed").length;
  const prospecting = DISTRIBUTOR_NETWORK.filter((d) => d.status === "prospecting").length;
  const planned = DISTRIBUTOR_NETWORK.filter((d) => d.status === "planned").length;

  // Chart data for composed chart
  const chartData = networkData.map((row) => ({
    month: row.month,
    newDistributors: row.newDistributors,
    cumulative: row.cumulativeDistributors,
    units: row.totalDistributorUnits,
    revenue: row.distributorRevenue,
  }));

  // Pipeline milestones
  const pipelineMilestones = MILESTONES.filter((m) =>
    ["first-distributor", "second-distributor", "third-distributor", "first-reorder", "second-reorder", "ebitda-positive", "100k-units"].includes(m.id)
  );

  return (
    <div style={{ background: CREAM, minHeight: "100vh", padding: "0 0 60px" }}>
      {/* HEADER */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <MapPin size={24} color={RED} />
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: NAVY,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Territory & Pipeline
          </h1>
        </div>
        <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
          Distribution Network & B2B Growth Tracking
        </p>
      </div>

      {/* ================================================================= */}
      {/* 1. DISTRIBUTOR NETWORK DASHBOARD */}
      {/* ================================================================= */}
      <SectionTitle icon={Users}>Distributor Network Dashboard</SectionTitle>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <MetricCard
          label="Target Distributors"
          value={String(totalDistributors)}
          sub="By end of Q1 2027"
          accent={NAVY}
        />
        <MetricCard
          label="Confirmed"
          value={String(confirmed)}
          sub="Brent Inderbitzin — May start"
          accent="#16a34a"
        />
        <MetricCard
          label="Annual Dist. Units"
          value={fmtUnits(distributorUnits)}
          sub={`${fmtDollar(distributorRevenue)} revenue`}
          accent={RED}
        />
        <MetricCard
          label="Wholesale Price"
          value={`$${UNIT_ECONOMICS.distributor.sellPrice.toFixed(2)}`}
          sub={`$${UNIT_ECONOMICS.distributor.gpPerUnit.toFixed(2)} GP/unit`}
          accent={GOLD}
        />
      </div>

      {/* Distributor Ramp Chart */}
      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "20px 20px 10px",
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
          Distributor Network Growth
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
          Monthly units through distribution channel + cumulative distributor count
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
            <YAxis yAxisId="units" tick={{ fontSize: 11, fill: MUTED }} tickFormatter={(v: number) => fmtUnits(v)} />
            <YAxis yAxisId="dist" orientation="right" domain={[0, 5]} tick={{ fontSize: 11, fill: MUTED }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar yAxisId="units" dataKey="units" name="Distributor Units" fill={NAVY} radius={[4, 4, 0, 0]} opacity={0.8}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.units > 0 ? NAVY : "rgba(27,42,74,0.15)"} />
              ))}
            </Bar>
            <Line
              yAxisId="dist"
              type="stepAfter"
              dataKey="cumulative"
              name="Total Distributors"
              stroke={RED}
              strokeWidth={3}
              dot={{ r: 5, fill: RED, stroke: WHITE, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ================================================================= */}
      {/* 2. NETWORK RAMP TABLE */}
      {/* ================================================================= */}
      <SectionTitle icon={BarChart3}>Network Ramp Schedule</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: NAVY }}>
                {["Month", "New Dist.", "Cumulative", "Units/Dist.", "Total Units", "Revenue"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "12px 14px",
                      textAlign: h === "Month" ? "left" : "right",
                      color: WHITE,
                      fontWeight: 600,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {networkData.map((row, i) => {
                const isInflection = row.newDistributors > 0;
                return (
                  <tr
                    key={row.month}
                    style={{
                      background: isInflection ? `${RED}08` : i % 2 === 0 ? "transparent" : LIGHT_NAVY,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 14px",
                        fontWeight: isInflection ? 700 : 500,
                        color: NAVY,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isInflection && (
                        <span style={{ color: RED, marginRight: 6, fontSize: 10 }}>&#9679;</span>
                      )}
                      {MONTH_FULL_LABELS[row.monthKey]}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: isInflection ? 700 : 400, color: isInflection ? RED : NAVY }}>
                      {row.newDistributors > 0 ? `+${row.newDistributors}` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.cumulativeDistributors}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", color: MUTED }}>
                      {row.unitsPerDistributor > 0 ? fmtUnits(row.unitsPerDistributor) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.totalDistributorUnits > 0 ? fmtUnits(row.totalDistributorUnits) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.distributorRevenue > 0 ? fmtDollar(row.distributorRevenue) : "—"}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background: NAVY }}>
                <td style={{ padding: "12px 14px", fontWeight: 700, color: WHITE }}>TOTAL (2026)</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {DISTRIBUTOR_NETWORK.filter((d) => MONTHS.includes(d.startMonth as Month)).length}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>—</td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>—</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {fmtUnits(distributorUnits)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {fmtDollar(distributorRevenue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. B2B PIPELINE FUNNEL */}
      {/* ================================================================= */}
      <SectionTitle icon={Target}>B2B Pipeline Funnel</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
          Distributor acquisition funnel — target {totalDistributors} distribution partners by Q1 2027
        </div>

        <FunnelBar
          label="Prospects Identified"
          value={totalNewNeeded}
          maxValue={totalNewNeeded}
          color={NAVY}
          sub="Total distribution partners in plan"
        />
        <FunnelBar
          label="In Contact / Prospecting"
          value={confirmed + prospecting}
          maxValue={totalNewNeeded}
          color="#2563eb"
          sub="Active conversations and outreach"
        />
        <FunnelBar
          label="Sampling / Evaluation"
          value={confirmed + prospecting}
          maxValue={totalNewNeeded}
          color={GOLD}
          sub="Product samples sent, terms under review"
        />
        <FunnelBar
          label="Committed"
          value={confirmed}
          maxValue={totalNewNeeded}
          color="#16a34a"
          sub="Signed or verbally committed"
        />
        <FunnelBar
          label="Active & Ordering"
          value={0}
          maxValue={totalNewNeeded}
          color={RED}
          sub="First orders ship May 2026"
        />

        {/* Distributor detail cards */}
        <div style={{ marginTop: 24, borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Distributor Partners</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {DISTRIBUTOR_NETWORK.map((d) => {
              const statusColor =
                d.status === "confirmed" ? "#16a34a" : d.status === "prospecting" ? "#2563eb" : MUTED;
              return (
                <div
                  key={d.id}
                  style={{
                    background: CREAM,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "14px 18px",
                    flex: "1 1 200px",
                    minWidth: 180,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Truck size={16} color={statusColor} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{d.name}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>Start</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
                      {typeof d.startMonth === "string" && MONTH_FULL_LABELS[d.startMonth as Month]
                        ? MONTH_FULL_LABELS[d.startMonth as Month]
                        : d.startMonth}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>Territory</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{d.territory}</span>
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusColor,
                      background: `${statusColor}12`,
                      padding: "3px 10px",
                      borderRadius: 12,
                      textTransform: "capitalize",
                      marginTop: 4,
                    }}
                  >
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
                    {d.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 4. CHANNEL TERRITORY MAP */}
      {/* ================================================================= */}
      <SectionTitle icon={Globe}>Channel Territory Map</SectionTitle>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
        <TerritoryCard
          title="Amazon Territory"
          icon={ShoppingBag}
          description="Direct-to-Consumer via Amazon FBA"
          annualUnits={amazonUnits}
          annualRevenue={amazonRevenue}
          status="Active — Launched"
          statusColor="#16a34a"
          metrics={[
            { label: "Retail Price", value: `$${UNIT_ECONOMICS.amazon.retailPrice}` },
            { label: "FBA Fees/Unit", value: `$${UNIT_ECONOMICS.amazon.fbaFees}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.amazon.gpPerUnit.toFixed(2)}` },
            { label: "Target ACoS", value: "< 30%" },
          ]}
        />
        <TerritoryCard
          title="Wholesale Territory"
          icon={Store}
          description="B2B via Faire + Direct Wholesale"
          annualUnits={wholesaleUnits}
          annualRevenue={wholesaleRevenue}
          status="Active — Growing"
          statusColor="#2563eb"
          metrics={[
            { label: "Wholesale Price", value: `$${UNIT_ECONOMICS.wholesale.price}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.wholesale.gpPerUnit.toFixed(2)}` },
            { label: "Account Target", value: "50+ retailers" },
            { label: "Reorder Rate Target", value: "> 60%" },
          ]}
        />
        <TerritoryCard
          title="Distributor Territory"
          icon={Truck}
          description="Regional Distribution Network"
          annualUnits={distributorUnits}
          annualRevenue={distributorRevenue}
          status="Building — Ramp Phase"
          statusColor={GOLD}
          metrics={[
            { label: "Sell Price", value: `$${UNIT_ECONOMICS.distributor.sellPrice}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.distributor.gpPerUnit.toFixed(2)}` },
            { label: "Distributor Count", value: `${totalDistributors} planned` },
            { label: "Units/Dist./Mo", value: "1.5K–6K ramp" },
          ]}
        />
      </div>

      {/* Channel Revenue Comparison Chart */}
      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "20px 20px 10px",
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
          Revenue by Channel — Monthly Plan
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
          Stacked view showing Amazon, Wholesale, and Distributor revenue targets
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={MONTHS.map((m) => ({
              month: MONTH_LABELS[m],
              Amazon: AMAZON.revenue[m],
              Wholesale: WHOLESALE.revenue[m],
              Distributor: DISTRIBUTOR.revenue[m],
            }))}
            margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
            <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="Amazon" name="Amazon Revenue" stackId="rev" fill={GOLD} radius={[0, 0, 0, 0]} />
            <Bar dataKey="Wholesale" name="Wholesale Revenue" stackId="rev" fill="#2563eb" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Distributor" name="Distributor Revenue" stackId="rev" fill={RED} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", padding: "10px 0 6px" }}>
          {[
            { label: "Amazon", color: GOLD },
            { label: "Wholesale", color: "#2563eb" },
            { label: "Distributor", color: RED },
          ].map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
              <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 5. MONTHLY PIPELINE ACTIVITY TIMELINE */}
      {/* ================================================================= */}
      <SectionTitle icon={Calendar}>Monthly Pipeline Activity</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
          Key milestones and distributor ramp events across the plan period
        </div>

        <div style={{ position: "relative" as const, paddingLeft: 32 }}>
          {/* Vertical timeline line */}
          <div
            style={{
              position: "absolute" as const,
              left: 11,
              top: 0,
              bottom: 0,
              width: 2,
              background: BORDER,
            }}
          />

          {MONTHS.map((m, idx) => {
            const monthDistributors = DISTRIBUTOR_NETWORK.filter((d) => d.startMonth === m);
            const monthMilestones = pipelineMilestones.filter((ms) => ms.targetMonth === m);
            const hasActivity = monthDistributors.length > 0 || monthMilestones.length > 0;
            const distUnits = DISTRIBUTOR.units[m];
            const totalRev = AMAZON.revenue[m] + WHOLESALE.revenue[m] + DISTRIBUTOR.revenue[m];

            return (
              <div
                key={m}
                style={{
                  position: "relative" as const,
                  marginBottom: idx < MONTHS.length - 1 ? 20 : 0,
                  paddingBottom: idx < MONTHS.length - 1 ? 20 : 0,
                  borderBottom: idx < MONTHS.length - 1 ? `1px solid ${LIGHT_NAVY}` : "none",
                }}
              >
                {/* Timeline dot */}
                <div
                  style={{
                    position: "absolute" as const,
                    left: -27,
                    top: 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: hasActivity ? RED : BORDER,
                    border: `3px solid ${WHITE}`,
                    boxShadow: hasActivity ? `0 0 0 3px ${RED}30` : "none",
                  }}
                />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
                      {MONTH_FULL_LABELS[m]} 2026
                    </div>

                    {monthDistributors.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Truck size={13} color={RED} />
                        <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>
                          {monthDistributors.map((d) => d.name).join(", ")} goes live
                        </span>
                      </div>
                    )}

                    {monthMilestones.map((ms) => (
                      <div key={ms.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <CheckCircle2 size={13} color="#16a34a" />
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>{ms.label}</span>
                      </div>
                    ))}

                    {!hasActivity && (
                      <div style={{ fontSize: 12, color: MUTED }}>Standard operations</div>
                    )}
                  </div>

                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 11, color: MUTED }}>Total Revenue</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>{fmtDollar(totalRev)}</div>
                    {distUnits > 0 && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                        {fmtUnits(distUnits)} dist. units
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================= */}
      {/* ANNUAL SUMMARY FOOTER */}
      {/* ================================================================= */}
      <div
        style={{
          background: NAVY,
          borderRadius: 12,
          padding: "20px 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            2026 Total Units
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: GOLD }}>{fmtUnits(ANNUAL_SUMMARY.totalUnits)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            2026 Total Revenue
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: GOLD }}>{fmtDollar(ANNUAL_SUMMARY.totalRevenue)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            Blended Gross Margin
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: WHITE }}>{(ANNUAL_SUMMARY.blendedGrossMargin * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            Distribution Partners
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: WHITE }}>{totalDistributors} Planned</div>
        </div>
      </div>
    </div>
  );
}
